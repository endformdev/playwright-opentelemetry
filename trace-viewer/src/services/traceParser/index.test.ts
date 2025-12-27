import { describe, expect, it } from "vitest";
import type { OtlpTraceExport } from "../../types/otel";
import {
	createScreenshots,
	flattenAttributes,
	nanosToMillis,
	parseOtlpTrace,
} from "./index";

describe("nanosToMillis", () => {
	it("converts nanoseconds string to milliseconds", () => {
		// 1 second = 1_000_000_000 nanoseconds = 1000 milliseconds
		expect(nanosToMillis("1000000000")).toBe(1000);
	});

	it("handles large nanosecond values", () => {
		// 1735290000000000000 ns = 1735290000000 ms (a realistic timestamp)
		expect(nanosToMillis("1735290000000000000")).toBe(1735290000000);
	});

	it("handles zero", () => {
		expect(nanosToMillis("0")).toBe(0);
	});
});

describe("flattenAttributes", () => {
	it("flattens string attributes", () => {
		const result = flattenAttributes([
			{ key: "test.name", value: { stringValue: "my test" } },
		]);
		expect(result).toEqual({ "test.name": "my test" });
	});

	it("flattens int attributes", () => {
		const result = flattenAttributes([
			{ key: "code.line", value: { intValue: 42 } },
		]);
		expect(result).toEqual({ "code.line": 42 });
	});

	it("flattens double attributes", () => {
		const result = flattenAttributes([
			{ key: "duration", value: { doubleValue: 1.5 } },
		]);
		expect(result).toEqual({ duration: 1.5 });
	});

	it("flattens boolean attributes", () => {
		const result = flattenAttributes([
			{ key: "passed", value: { boolValue: true } },
		]);
		expect(result).toEqual({ passed: true });
	});

	it("handles multiple attributes", () => {
		const result = flattenAttributes([
			{ key: "name", value: { stringValue: "test" } },
			{ key: "line", value: { intValue: 10 } },
			{ key: "passed", value: { boolValue: false } },
		]);
		expect(result).toEqual({
			name: "test",
			line: 10,
			passed: false,
		});
	});
});

describe("createScreenshots", () => {
	it("creates screenshot objects from filenames", () => {
		const filenames = ["1735290000000_page1.jpeg", "1735290001000_page1.jpeg"];
		const baseUrl = "/screenshots/trace-123";

		const result = createScreenshots(filenames, baseUrl);

		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({
			id: "screenshot-0",
			filename: "1735290000000_page1.jpeg",
			timestamp: 1735290000000,
			url: "/screenshots/trace-123/1735290000000_page1.jpeg",
		});
		expect(result[1]).toEqual({
			id: "screenshot-1",
			filename: "1735290001000_page1.jpeg",
			timestamp: 1735290001000,
			url: "/screenshots/trace-123/1735290001000_page1.jpeg",
		});
	});

	it("handles filenames without timestamp prefix", () => {
		const filenames = ["screenshot.png"];
		const result = createScreenshots(filenames, "/base");

		expect(result[0].timestamp).toBe(0);
		expect(result[0].url).toBe("/base/screenshot.png");
	});
});

describe("parseOtlpTrace", () => {
	it("parses a minimal trace with test span", () => {
		const otlp: OtlpTraceExport = {
			resourceSpans: [
				{
					resource: {
						attributes: [
							{ key: "service.name", value: { stringValue: "test-service" } },
							{
								key: "service.namespace",
								value: { stringValue: "playwright" },
							},
							{ key: "service.version", value: { stringValue: "1.0.0" } },
						],
					},
					scopeSpans: [
						{
							scope: { name: "playwright-opentelemetry", version: "1.0.0" },
							spans: [
								{
									traceId: "trace-1",
									spanId: "span-1",
									name: "playwright.test",
									kind: 1,
									startTimeUnixNano: "1735290000000000000",
									endTimeUnixNano: "1735290001000000000",
									attributes: [
										{
											key: "test.case.name",
											value: { stringValue: "my test" },
										},
										{
											key: "test.case.result.status",
											value: { stringValue: "passed" },
										},
										{
											key: "code.file.path",
											value: { stringValue: "test.spec.ts" },
										},
										{ key: "code.line.number", value: { intValue: 10 } },
									],
									droppedAttributesCount: 0,
									events: [],
									droppedEventsCount: 0,
									status: { code: 0 },
									links: [],
									droppedLinksCount: 0,
								},
							],
						},
					],
				},
			],
		};

		const result = parseOtlpTrace(otlp, []);

		expect(result.testInfo.name).toBe("my test");
		expect(result.testInfo.outcome).toBe("passed");
		expect(result.testInfo.duration).toBe(1000);
		expect(result.testInfo.file).toBe("test.spec.ts");
		expect(result.testInfo.line).toBe(10);
		expect(result.rootSpan.name).toBe("playwright.test");
		expect(result.rootSpan.kind).toBe("test");
		expect(result.spans.size).toBe(1);
		expect(result.timeRange.duration).toBe(1000);
	});

	it("builds span tree with parent-child relationships", () => {
		const otlp: OtlpTraceExport = {
			resourceSpans: [
				{
					resource: { attributes: [] },
					scopeSpans: [
						{
							scope: { name: "test", version: "1.0.0" },
							spans: [
								{
									traceId: "trace-1",
									spanId: "root",
									name: "playwright.test",
									kind: 1,
									startTimeUnixNano: "1000000000000",
									endTimeUnixNano: "5000000000000",
									attributes: [],
									droppedAttributesCount: 0,
									events: [],
									droppedEventsCount: 0,
									status: { code: 0 },
									links: [],
									droppedLinksCount: 0,
								},
								{
									traceId: "trace-1",
									spanId: "child-1",
									parentSpanId: "root",
									name: "playwright.test.step",
									kind: 1,
									startTimeUnixNano: "1000000000000",
									endTimeUnixNano: "2000000000000",
									attributes: [
										{
											key: "test.step.title",
											value: { stringValue: "Step 1" },
										},
									],
									droppedAttributesCount: 0,
									events: [],
									droppedEventsCount: 0,
									status: { code: 0 },
									links: [],
									droppedLinksCount: 0,
								},
								{
									traceId: "trace-1",
									spanId: "child-2",
									parentSpanId: "root",
									name: "playwright.test.step",
									kind: 1,
									startTimeUnixNano: "3000000000000",
									endTimeUnixNano: "4000000000000",
									attributes: [
										{
											key: "test.step.title",
											value: { stringValue: "Step 2" },
										},
									],
									droppedAttributesCount: 0,
									events: [],
									droppedEventsCount: 0,
									status: { code: 0 },
									links: [],
									droppedLinksCount: 0,
								},
							],
						},
					],
				},
			],
		};

		const result = parseOtlpTrace(otlp, []);

		expect(result.rootSpan.id).toBe("root");
		expect(result.rootSpan.children).toHaveLength(2);
		expect(result.rootSpan.children[0].id).toBe("child-1");
		expect(result.rootSpan.children[1].id).toBe("child-2");
		expect(result.rootSpan.depth).toBe(0);
		expect(result.rootSpan.children[0].depth).toBe(1);
	});

	it("identifies network spans by http.method attribute", () => {
		const otlp: OtlpTraceExport = {
			resourceSpans: [
				{
					resource: { attributes: [] },
					scopeSpans: [
						{
							scope: { name: "test", version: "1.0.0" },
							spans: [
								{
									traceId: "trace-1",
									spanId: "root",
									name: "playwright.test",
									kind: 1,
									startTimeUnixNano: "1000000000000",
									endTimeUnixNano: "5000000000000",
									attributes: [],
									droppedAttributesCount: 0,
									events: [],
									droppedEventsCount: 0,
									status: { code: 0 },
									links: [],
									droppedLinksCount: 0,
								},
								{
									traceId: "trace-1",
									spanId: "network-1",
									parentSpanId: "root",
									name: "GET /api/users",
									kind: 1,
									startTimeUnixNano: "2000000000000",
									endTimeUnixNano: "3000000000000",
									attributes: [
										{ key: "http.method", value: { stringValue: "GET" } },
										{
											key: "http.url",
											value: { stringValue: "https://api.example.com/users" },
										},
										{ key: "http.status_code", value: { intValue: 200 } },
									],
									droppedAttributesCount: 0,
									events: [],
									droppedEventsCount: 0,
									status: { code: 0 },
									links: [],
									droppedLinksCount: 0,
								},
							],
						},
					],
				},
			],
		};

		const result = parseOtlpTrace(otlp, []);
		const networkSpan = result.spans.get("network-1");

		expect(networkSpan?.kind).toBe("network");
		expect(networkSpan?.attributes["http.method"]).toBe("GET");
		expect(networkSpan?.attributes["http.status_code"]).toBe(200);
	});

	it("throws error when no spans found", () => {
		const otlp: OtlpTraceExport = {
			resourceSpans: [
				{
					resource: { attributes: [] },
					scopeSpans: [
						{
							scope: { name: "test", version: "1.0.0" },
							spans: [],
						},
					],
				},
			],
		};

		expect(() => parseOtlpTrace(otlp, [])).toThrow("No spans found in trace");
	});
});
