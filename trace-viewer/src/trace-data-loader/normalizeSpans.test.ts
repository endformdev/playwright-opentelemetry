import { describe, expect, it } from "vitest";
import type { OtlpSpan, OtlpTraceExport } from "../trace-info-loader/otel";
import { normalizeOtlpExport, normalizeSpan } from "./normalizeSpans";

describe("normalizeSpan", () => {
	it("extracts basic span properties", () => {
		const span = createOtlpSpan({
			traceId: "abc123",
			spanId: "def456",
			name: "HTTP GET",
		});

		const result = normalizeSpan(span, 500); // test started at 500ms

		expect(result.id).toBe("def456");
		expect(result.traceId).toBe("abc123");
		expect(result.name).toBe("HTTP GET");
	});

	it("calculates startOffsetMs relative to test start", () => {
		// Span starts at 2000ms, ends at 2500ms
		// In nanoseconds: 2000ms = 2,000,000,000 nanos (2e9)
		const span = createOtlpSpan({
			startTimeUnixNano: "2000000000", // 2000ms in nanos
			endTimeUnixNano: "2500000000", // 2500ms in nanos
		});

		// Test started at 1000ms (in milliseconds, matching what TestInfo provides)
		const testStartTimeMs = 1000;
		const result = normalizeSpan(span, testStartTimeMs);

		// startOffsetMs = 2000ms - 1000ms = 1000ms
		expect(result.startOffsetMs).toBe(1000);
		// durationMs = 2500ms - 2000ms = 500ms
		expect(result.durationMs).toBe(500);
	});

	it("handles parentSpanId", () => {
		const spanWithParent = createOtlpSpan({
			parentSpanId: "parent123",
		});
		const spanWithoutParent = createOtlpSpan({
			parentSpanId: undefined,
		});

		expect(normalizeSpan(spanWithParent, 0).parentId).toBe("parent123");
		expect(normalizeSpan(spanWithoutParent, 0).parentId).toBe(null);
	});

	it("maps OTLP span kinds correctly", () => {
		const internalSpan = createOtlpSpan({ kind: 1 });
		const serverSpan = createOtlpSpan({ kind: 2 });
		const clientSpan = createOtlpSpan({ kind: 3 });
		const producerSpan = createOtlpSpan({ kind: 4 });
		const consumerSpan = createOtlpSpan({ kind: 5 });
		const unspecifiedSpan = createOtlpSpan({ kind: 0 });

		expect(normalizeSpan(internalSpan, 0).kind).toBe("internal");
		expect(normalizeSpan(serverSpan, 0).kind).toBe("server");
		expect(normalizeSpan(clientSpan, 0).kind).toBe("client");
		expect(normalizeSpan(producerSpan, 0).kind).toBe("producer");
		expect(normalizeSpan(consumerSpan, 0).kind).toBe("consumer");
		expect(normalizeSpan(unspecifiedSpan, 0).kind).toBe("internal"); // defaults to internal
	});

	it("extracts title from test.step.title attribute", () => {
		const span = createOtlpSpan({
			name: "playwright.test.step",
			attributes: [
				{ key: "test.step.title", value: { stringValue: "Click button" } },
			],
		});

		const result = normalizeSpan(span, 0);

		expect(result.title).toBe("Click button");
		expect(result.name).toBe("playwright.test.step");
	});

	it("extracts title from test.case.title attribute", () => {
		const span = createOtlpSpan({
			name: "playwright.test",
			attributes: [
				{ key: "test.case.title", value: { stringValue: "should login" } },
			],
		});

		const result = normalizeSpan(span, 0);

		expect(result.title).toBe("should login");
	});

	it("falls back to span name when no title attribute", () => {
		const span = createOtlpSpan({
			name: "HTTP GET /api/users",
			attributes: [{ key: "http.method", value: { stringValue: "GET" } }],
		});

		const result = normalizeSpan(span, 0);

		expect(result.title).toBe("HTTP GET /api/users");
	});

	it("flattens attributes to simple values", () => {
		const span = createOtlpSpan({
			attributes: [
				{ key: "string.attr", value: { stringValue: "hello" } },
				{ key: "int.attr", value: { intValue: 42 } },
				{ key: "double.attr", value: { doubleValue: 3.14 } },
				{ key: "bool.attr", value: { boolValue: true } },
			],
		});

		const result = normalizeSpan(span, 0);

		expect(result.attributes["string.attr"]).toBe("hello");
		expect(result.attributes["int.attr"]).toBe(42);
		expect(result.attributes["double.attr"]).toBe(3.14);
		expect(result.attributes["bool.attr"]).toBe(true);
	});
});

describe("normalizeOtlpExport", () => {
	it("returns empty array for empty export", () => {
		const otlp: OtlpTraceExport = { resourceSpans: [] };

		const result = normalizeOtlpExport(otlp, 0);

		expect(result).toEqual([]);
	});

	it("extracts spans from nested structure", () => {
		const otlp: OtlpTraceExport = {
			resourceSpans: [
				{
					resource: { attributes: [] },
					scopeSpans: [
						{
							scope: { name: "test", version: "1.0" },
							spans: [
								createOtlpSpan({ spanId: "span1", name: "span1" }),
								createOtlpSpan({ spanId: "span2", name: "span2" }),
							],
						},
					],
				},
			],
		};

		const result = normalizeOtlpExport(otlp, 0);

		expect(result).toHaveLength(2);
		expect(result[0].id).toBe("span1");
		expect(result[1].id).toBe("span2");
	});

	it("extracts spans from multiple resourceSpans and scopeSpans", () => {
		const otlp: OtlpTraceExport = {
			resourceSpans: [
				{
					resource: { attributes: [] },
					scopeSpans: [
						{
							scope: { name: "scope1", version: "1.0" },
							spans: [createOtlpSpan({ spanId: "s1" })],
						},
						{
							scope: { name: "scope2", version: "1.0" },
							spans: [createOtlpSpan({ spanId: "s2" })],
						},
					],
				},
				{
					resource: { attributes: [] },
					scopeSpans: [
						{
							scope: { name: "scope3", version: "1.0" },
							spans: [createOtlpSpan({ spanId: "s3" })],
						},
					],
				},
			],
		};

		const result = normalizeOtlpExport(otlp, 0);

		expect(result).toHaveLength(3);
		expect(result.map((s) => s.id)).toContain("s1");
		expect(result.map((s) => s.id)).toContain("s2");
		expect(result.map((s) => s.id)).toContain("s3");
	});

	it("sorts spans by startOffsetMs", () => {
		const otlp: OtlpTraceExport = {
			resourceSpans: [
				{
					resource: { attributes: [] },
					scopeSpans: [
						{
							scope: { name: "test", version: "1.0" },
							spans: [
								createOtlpSpan({
									spanId: "late",
									startTimeUnixNano: "3000000000", // 3000ms
									endTimeUnixNano: "3100000000",
								}),
								createOtlpSpan({
									spanId: "early",
									startTimeUnixNano: "1000000000", // 1000ms
									endTimeUnixNano: "1100000000",
								}),
								createOtlpSpan({
									spanId: "middle",
									startTimeUnixNano: "2000000000", // 2000ms
									endTimeUnixNano: "2100000000",
								}),
							],
						},
					],
				},
			],
		};

		const result = normalizeOtlpExport(otlp, 0);

		expect(result[0].id).toBe("early");
		expect(result[1].id).toBe("middle");
		expect(result[2].id).toBe("late");
	});
});

function createOtlpSpan(overrides: Partial<OtlpSpan> = {}): OtlpSpan {
	return {
		traceId: "trace123",
		spanId: "span456",
		name: "test.span",
		kind: 1, // INTERNAL
		startTimeUnixNano: "1000000000", // 1000ms in nanos (1e9)
		endTimeUnixNano: "1100000000", // 1100ms in nanos
		attributes: [],
		droppedAttributesCount: 0,
		events: [],
		droppedEventsCount: 0,
		status: { code: 1 },
		links: [],
		droppedLinksCount: 0,
		...overrides,
	};
}
