import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaywrightOpentelemetryConfig } from "../src/shared/config";
import { runReporterTest } from "./reporter-harness";

const mockFetch = vi.fn();

describe("Trace API Integration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = mockFetch;
		mockFetch.mockResolvedValue({ ok: true, status: 200 });
	});

	it("sends OTLP spans with test metadata to trace API endpoint", async () => {
		/**
		 * Full integration test: A complete test run with steps and network activity
		 * should send all data to the trace API:
		 * 1. OTLP spans to POST {endpoint}/v1/traces
		 * 2. Test metadata as root playwright.test span attributes
		 * 3. Screenshots to PUT {endpoint}/playwright-otel-reporter/v1/screenshots.zip
		 *
		 * All requests should include:
		 * - X-Trace-Id header with the test's traceId
		 * - Custom headers from playwrightTraceApiHeaders
		 */
		const options: PlaywrightOpentelemetryConfig = {
			playwrightTraceApiEndpoint: "https://traces.example.com",
			playwrightTraceApiHeaders: {
				Authorization: "Bearer test-token",
			},
		};

		await runReporterTest({
			playwrightOpentelemetry: options,
			test: {
				title: "should complete checkout flow",
				titlePath: [
					"",
					"chromium",
					"checkout.spec.ts",
					"E2E Tests",
					"Checkout",
					"should complete checkout flow",
				],
				location: {
					file: "/Users/test/project/test-e2e/checkout.spec.ts",
					line: 42,
				},
			},
			result: {
				status: "passed",
				duration: 5000,
				steps: [
					{
						title: "Navigate to product page",
						category: "test.step",
						duration: 1000,
						networkActions: [
							{
								method: "GET",
								url: "https://shop.example.com/products/123",
								statusCode: 200,
								duration: 150,
							},
						],
					},
					{
						title: "Add to cart",
						category: "test.step",
						duration: 500,
						networkActions: [
							{
								method: "POST",
								url: "https://api.example.com/cart",
								statusCode: 201,
								duration: 200,
							},
						],
					},
					{
						title: "Complete checkout",
						category: "test.step",
						duration: 2000,
						networkActions: [
							{
								method: "POST",
								url: "https://api.example.com/checkout",
								statusCode: 200,
								duration: 500,
							},
						],
					},
				],
			},
		});

		// Verify OTLP spans were sent
		const otlpCalls = mockFetch.mock.calls.filter(
			(call) =>
				call[0] === "https://traces.example.com/v1/traces" &&
				call[1]?.method === "POST",
		);
		expect(otlpCalls.length).toBeGreaterThanOrEqual(1);

		// Verify OTLP request format
		const otlpCall = otlpCalls[0];
		expect(otlpCall[1].headers).toMatchObject({
			"content-type": "application/json",
			Authorization: "Bearer test-token",
		});
		const otlpBody = JSON.parse(otlpCall[1].body);
		expect(otlpBody.resourceSpans).toBeDefined();
		expect(
			otlpBody.resourceSpans[0].scopeSpans[0].spans.length,
		).toBeGreaterThan(0);

		// Extract traceId from OTLP payload for verification
		const traceId = otlpBody.resourceSpans[0].scopeSpans[0].spans[0].traceId;
		expect(traceId).toMatch(/^[0-9a-f]{32}$/);

		const testSpan = otlpBody.resourceSpans[0].scopeSpans[0].spans.find(
			(span: { name: string }) => span.name === "playwright.test",
		);
		expect(testSpan.attributes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: "test.case.title",
					value: { stringValue: "should complete checkout flow" },
				}),
				expect.objectContaining({
					key: "playwright.test.status",
					value: { stringValue: "passed" },
				}),
				expect.objectContaining({
					key: "playwright.test.describes",
				}),
			]),
		);
	});

	it("uses generated trace context for trace API export when the fixture is missing", async () => {
		const options: PlaywrightOpentelemetryConfig = {
			playwrightTraceApiEndpoint: "https://traces.example.com",
			playwrightTraceApiHeaders: {
				Authorization: "Bearer test-token",
			},
		};

		const { testResult } = await runReporterTest({
			includeTraceContextAttachment: false,
			playwrightOpentelemetry: options,
			test: {
				title: "reporter only trace api test",
				titlePath: [
					"",
					"chromium",
					"trace-api.spec.ts",
					"reporter only trace api test",
				],
				location: {
					file: "/Users/test/project/test-e2e/trace-api.spec.ts",
					line: 7,
				},
			},
			result: {
				steps: [
					{
						title: "Step without fixture",
						category: "test.step",
						duration: 100,
					},
				],
			},
		});

		const otlpCall = mockFetch.mock.calls.find(
			(call) =>
				call[0] === "https://traces.example.com/v1/traces" &&
				call[1]?.method === "POST",
		);
		if (!otlpCall) {
			throw new Error("Expected trace API OTLP request");
		}
		const otlpBody = JSON.parse(otlpCall[1].body);
		const spans = otlpBody.resourceSpans[0].scopeSpans[0].spans;
		const testSpan = spans.find(
			(span: { name: string }) => span.name === "playwright.test",
		);
		const stepSpan = spans.find(
			(span: { name: string }) => span.name === "playwright.test.step",
		);
		expect(testSpan.traceId).toMatch(/^[0-9a-f]{32}$/);
		expect(stepSpan).toEqual(
			expect.objectContaining({
				traceId: testSpan.traceId,
				parentSpanId: testSpan.spanId,
			}),
		);

		const screenshotsCall = mockFetch.mock.calls.find(
			(call) =>
				call[0] ===
					"https://traces.example.com/playwright-otel-reporter/v1/screenshots.zip" &&
				call[1]?.method === "PUT",
		);
		if (!screenshotsCall) {
			throw new Error("Expected trace API screenshots request");
		}
		expect(screenshotsCall[1].headers).toMatchObject({
			"x-trace-id": testSpan.traceId,
			Authorization: "Bearer test-token",
		});

		expect(testResult.annotations).toContainEqual({
			type: "playwrightOpentelemetryTraceId",
			description: testSpan.traceId,
		});
	});

	it("sends data to both OTLP endpoint and trace API endpoint when both configured", async () => {
		/**
		 * When both otlpEndpoint and playwrightTraceApiEndpoint are configured,
		 * spans should be sent to both endpoints, and screenshots should only go to the trace API endpoint.
		 */
		const options: PlaywrightOpentelemetryConfig = {
			otlpEndpoint: "https://otel-collector.example.com/v1/traces",
			otlpHeaders: {
				"x-honeycomb-team": "honeycomb-api-key",
			},
			playwrightTraceApiEndpoint: "https://traces.example.com",
			playwrightTraceApiHeaders: {
				Authorization: "Bearer trace-api-token",
			},
		};

		await runReporterTest({
			playwrightOpentelemetry: options,
			test: {
				title: "should login successfully",
				titlePath: [
					"",
					"chromium",
					"auth.spec.ts",
					"Authentication",
					"should login successfully",
				],
				location: {
					file: "/Users/test/project/test-e2e/auth.spec.ts",
					line: 15,
				},
			},
			result: {
				status: "passed",
				duration: 2000,
				steps: [
					{
						title: "Fill credentials",
						category: "test.step",
						duration: 500,
					},
					{
						title: "Click login",
						category: "test.step",
						duration: 1000,
					},
				],
			},
		});

		// Verify spans sent to OTLP collector
		const otelCollectorCalls = mockFetch.mock.calls.filter(
			(call) =>
				call[0] === "https://otel-collector.example.com/v1/traces" &&
				call[1]?.method === "POST",
		);
		expect(otelCollectorCalls).toHaveLength(1);
		expect(otelCollectorCalls[0][1].headers).toMatchObject({
			"content-type": "application/json",
			"x-honeycomb-team": "honeycomb-api-key",
		});

		// Verify spans also sent to trace API
		const traceApiOtlpCalls = mockFetch.mock.calls.filter(
			(call) =>
				call[0] === "https://traces.example.com/v1/traces" &&
				call[1]?.method === "POST",
		);
		expect(traceApiOtlpCalls).toHaveLength(1);
		expect(traceApiOtlpCalls[0][1].headers).toMatchObject({
			"content-type": "application/json",
			Authorization: "Bearer trace-api-token",
		});

		// Verify both OTLP payloads have the same traceId
		const otelBody = JSON.parse(otelCollectorCalls[0][1].body);
		const traceApiBody = JSON.parse(traceApiOtlpCalls[0][1].body);
		const otelTraceId =
			otelBody.resourceSpans[0].scopeSpans[0].spans[0].traceId;
		const traceApiTraceId =
			traceApiBody.resourceSpans[0].scopeSpans[0].spans[0].traceId;
		expect(otelTraceId).toBe(traceApiTraceId);

		expect(traceApiTraceId).toBe(otelTraceId);
	});
});
