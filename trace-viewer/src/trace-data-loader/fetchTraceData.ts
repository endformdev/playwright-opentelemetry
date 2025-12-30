import * as v from "valibot";
import { type CategorizedSpans, categorizeSpans } from "./categorizeSpans";
import { otlpExportToSpans } from "./exportToSpans";

/**
 * Valibot schema for OpenTelemetry Protocol (OTLP) JSON Export format.
 * @see https://opentelemetry.io/docs/specs/otlp/
 */

const OtlpAttributeValueSchema = v.object({
	stringValue: v.optional(v.string()),
	intValue: v.optional(v.number()),
	doubleValue: v.optional(v.number()),
	boolValue: v.optional(v.boolean()),
});

const OtlpAttributeSchema = v.object({
	key: v.string(),
	value: OtlpAttributeValueSchema,
});

const OtlpSpanStatusSchema = v.object({
	code: v.number(),
	message: v.optional(v.string()),
});

const OtlpSpanSchema = v.object({
	traceId: v.string(),
	spanId: v.string(),
	parentSpanId: v.optional(v.string()),
	name: v.string(),
	kind: v.number(),
	startTimeUnixNano: v.string(),
	endTimeUnixNano: v.string(),
	attributes: v.array(OtlpAttributeSchema),
	droppedAttributesCount: v.number(),
	events: v.array(v.unknown()),
	droppedEventsCount: v.number(),
	status: OtlpSpanStatusSchema,
	links: v.array(v.unknown()),
	droppedLinksCount: v.number(),
});

const OtlpScopeSchema = v.object({
	name: v.string(),
	version: v.string(),
});

const OtlpScopeSpansSchema = v.object({
	scope: OtlpScopeSchema,
	spans: v.array(OtlpSpanSchema),
});

const OtlpResourceSchema = v.object({
	attributes: v.array(OtlpAttributeSchema),
});

const OtlpResourceSpansSchema = v.object({
	resource: OtlpResourceSchema,
	scopeSpans: v.array(OtlpScopeSpansSchema),
});

const OtlpExportSchema = v.object({
	resourceSpans: v.array(OtlpResourceSpansSchema),
});

export type OtlpExport = v.InferOutput<typeof OtlpExportSchema>;
export type OtlpResourceSpans = v.InferOutput<typeof OtlpResourceSpansSchema>;
export type OtlpScopeSpans = v.InferOutput<typeof OtlpScopeSpansSchema>;
export type OtlpSpan = v.InferOutput<typeof OtlpSpanSchema>;
export type OtlpAttribute = v.InferOutput<typeof OtlpAttributeSchema>;
export type OtlpAttributeValue = v.InferOutput<typeof OtlpAttributeValueSchema>;

export async function fetchTraceData(
	url: string,
	testStartTimeMs: number,
): Promise<CategorizedSpans> {
	const response = await fetch(url);

	if (!response.ok) {
		const body = await response.text();
		throw new Error(
			`Failed to fetch trace data from ${url}: ${response.status} ${body}`,
		);
	}

	const json: unknown = await response.json();
	const otlpExport = v.parse(OtlpExportSchema, json);
	const spans = otlpExportToSpans(otlpExport, testStartTimeMs);

	return categorizeSpans(spans);
}
