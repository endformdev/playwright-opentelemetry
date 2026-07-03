import { beforeEach, describe, expect, it, vi } from "vitest";
import { runReporterTest } from "./reporter-harness";

vi.mock("../src/reporter/sender", () => ({
	sendSpans: vi.fn(),
}));

import { sendSpans } from "../src/reporter/sender";

describe("PlaywrightOpentelemetryReporter trace retention", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("publishes when Playwright retained a trace attachment", async () => {
		const { testResult } = await runReporterTest({
			test: { title: "retained trace" },
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);
		expect(testResult.annotations).toContainEqual(
			expect.objectContaining({
				type: "playwrightOpentelemetryTraceId",
				description: expect.stringMatching(/^[0-9a-f]{32}$/),
			}),
		);
	});

	it("does not publish spans when Playwright did not retain a trace attachment", async () => {
		const { testResult } = await runReporterTest({
			test: { title: "no retained trace" },
			result: { attachments: [] },
		});

		expect(sendSpans).not.toHaveBeenCalled();
		expect(testResult.annotations).not.toContainEqual(
			expect.objectContaining({
				type: "playwrightOpentelemetryTraceId",
			}),
		);
	});

	it("publishes without a Playwright trace attachment when the trace override retains the test", async () => {
		const { testResult } = await runReporterTest({
			playwrightOpentelemetry: { trace: "on" },
			test: { title: "otel trace override on" },
			result: { attachments: [] },
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);
		expect(testResult.annotations).toContainEqual(
			expect.objectContaining({
				type: "playwrightOpentelemetryTraceId",
				description: expect.stringMatching(/^[0-9a-f]{32}$/),
			}),
		);
	});

	it("does not publish with a Playwright trace attachment when the trace override discards the test", async () => {
		const { testResult } = await runReporterTest({
			playwrightOpentelemetry: { trace: "off" },
			test: { title: "otel trace override off" },
		});

		expect(sendSpans).not.toHaveBeenCalled();
		expect(testResult.annotations).not.toContainEqual(
			expect.objectContaining({
				type: "playwrightOpentelemetryTraceId",
			}),
		);
	});

	it("supports retry-based trace overrides without relying on Playwright attachments", async () => {
		await runReporterTest({
			playwrightOpentelemetry: { trace: "on-first-retry" },
			test: { title: "otel trace override retry" },
			result: { attachments: [], retry: 1 },
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);
	});

	it("uses destination-specific trace overrides for OTLP endpoints", async () => {
		await runReporterTest({
			playwrightOpentelemetry: {
				trace: "retain-on-failure",
				otlpEndpoint: {
					url: "https://kept.example.com/v1/traces",
					trace: "on",
				},
				otlpEndpoints: [
					{ url: "https://inherited.example.com/v1/traces" },
					{ url: "https://discarded.example.com/v1/traces", trace: "off" },
				],
			},
			test: { title: "destination trace override" },
			result: { attachments: [] },
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);
		expect(sendSpans).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({
				tracesEndpoint: "https://kept.example.com/v1/traces",
			}),
		);
	});

	it("uses destination-specific trace overrides for Trace API endpoints without a Playwright trace attachment", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			text: async () => "",
		});
		global.fetch = fetchMock;

		await runReporterTest({
			playwrightOpentelemetry: {
				trace: "retain-on-failure",
				playwrightTraceApiEndpoint: {
					url: "https://trace-api.example.com",
					trace: "on",
				},
			},
			test: { title: "trace api destination override" },
			result: { attachments: [] },
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);
		expect(sendSpans).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({
				tracesEndpoint: "https://trace-api.example.com/v1/traces",
			}),
		);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://trace-api.example.com/playwright-otel-reporter/v1/screenshots.zip",
			expect.objectContaining({ method: "PUT" }),
		);
	});
});
