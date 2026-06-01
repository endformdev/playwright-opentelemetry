import { describe, expect, it } from "vitest";
import {
	mergeOtlpExports,
	type OtlpExport,
	type OtlpResourceSpans,
	type OtlpScopeSpans,
	type OtlpSpan,
	partitionOtlpExportByTraceId,
} from "./otlp";

describe("OTLP trace grouping", () => {
	it("keeps a user trace intact when one OTLP batch contains backend spans for multiple traces", () => {
		const traceA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
		const traceB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
		const payload = otlpExport([
			resourceSpan("backend-api", [
				scopeSpan("http", [
					span(traceA, "GET /users"),
					span(traceB, "GET /orders"),
				]),
				scopeSpan("db", [
					span(traceA, "SELECT users"),
					span(traceB, "SELECT orders"),
				]),
			]),
			resourceSpan("playwright", [
				scopeSpan("playwright-opentelemetry", [
					span(traceA, "playwright.test"),
				]),
			]),
		]);

		const traces = partitionOtlpExportByTraceId(payload);

		expect(spanNames(traces.get(traceA))).toEqual([
			"GET /users",
			"SELECT users",
			"playwright.test",
		]);
		expect(spanNames(traces.get(traceB))).toEqual([
			"GET /orders",
			"SELECT orders",
		]);
		expect(serviceNames(traces.get(traceA))).toEqual([
			"backend-api",
			"backend-api",
			"playwright",
		]);
		expect(scopeNames(traces.get(traceA))).toEqual([
			"http",
			"db",
			"playwright-opentelemetry",
		]);
	});

	it("drops spans without trace IDs instead of creating unreadable trace data", () => {
		const traces = partitionOtlpExportByTraceId(
			otlpExport([
				resourceSpan("backend-api", [
					scopeSpan("http", [{ ...span(undefined, "missing trace id") }]),
				]),
			]),
		);

		expect(traces.size).toBe(0);
	});

	it("merges trace fragments into one OTLP export response", () => {
		const merged = mergeOtlpExports([
			otlpExport([
				resourceSpan("playwright", [scopeSpan("test", [span("a", "test")])]),
			]),
			otlpExport([
				resourceSpan("backend", [scopeSpan("http", [span("a", "GET")])]),
			]),
		]);

		expect(spanNames(merged)).toEqual(["test", "GET"]);
		expect(serviceNames(merged)).toEqual(["playwright", "backend"]);
	});
});

function otlpExport(resourceSpans: OtlpResourceSpans[]): OtlpExport {
	return { resourceSpans };
}

function resourceSpan(
	serviceName: string,
	scopeSpans: OtlpScopeSpans[],
): OtlpResourceSpans {
	return {
		resource: {
			attributes: [
				{ key: "service.name", value: { stringValue: serviceName } },
			],
		},
		scopeSpans,
	};
}

function scopeSpan(name: string, spans: OtlpSpan[]): OtlpScopeSpans {
	return { scope: { name }, spans };
}

function span(traceId: string | undefined, name: string): OtlpSpan {
	return {
		traceId,
		spanId: name
			.replace(/[^a-z0-9]/gi, "")
			.padEnd(16, "0")
			.slice(0, 16),
		name,
	};
}

function spanNames(payload: OtlpExport | undefined): string[] {
	return (payload?.resourceSpans ?? []).flatMap((resourceSpan) =>
		(resourceSpan.scopeSpans ?? []).flatMap((scopeSpan) =>
			(scopeSpan.spans ?? []).flatMap((span) =>
				typeof span.name === "string" ? [span.name] : [],
			),
		),
	);
}

function serviceNames(payload: OtlpExport | undefined): string[] {
	return (payload?.resourceSpans ?? []).flatMap((resourceSpan) => {
		const resource = resourceSpan.resource as Resource | undefined;
		const serviceName = resource?.attributes.find(
			(attribute) => attribute.key === "service.name",
		)?.value.stringValue;
		return serviceName === undefined ? [] : [serviceName];
	});
}

function scopeNames(payload: OtlpExport | undefined): string[] {
	return (payload?.resourceSpans ?? []).flatMap((resourceSpan) =>
		(resourceSpan.scopeSpans ?? []).flatMap((scopeSpan) => {
			const scope = scopeSpan.scope as { name?: unknown } | undefined;
			return typeof scope?.name === "string" ? [scope.name] : [];
		}),
	);
}

interface Resource {
	attributes: Array<{ key: string; value: { stringValue?: string } }>;
}
