/**
 * Converts OTLP trace data to normalized spans with relative timing.
 */

import type {
	OtlpAttribute,
	OtlpSpan,
	OtlpTraceExport,
} from "../trace-info-loader/otel";

/**
 * Span kind derived from OTLP span.kind integer.
 * Used for visual differentiation in the spans panel.
 */
export type SpanKind =
	| "internal"
	| "server"
	| "client"
	| "producer"
	| "consumer";

/**
 * OTLP span.kind values as defined in the OpenTelemetry specification.
 * @see https://opentelemetry.io/docs/specs/otel/trace/api/#spankind
 */
const OTLP_SPAN_KIND = {
	UNSPECIFIED: 0,
	INTERNAL: 1,
	SERVER: 2,
	CLIENT: 3,
	PRODUCER: 4,
	CONSUMER: 5,
} as const;

/**
 * Maps OTLP span.kind integer to SpanKind string.
 */
function spanKindFromOtlp(otlpKind: number): SpanKind {
	switch (otlpKind) {
		case OTLP_SPAN_KIND.SERVER:
			return "server";
		case OTLP_SPAN_KIND.CLIENT:
			return "client";
		case OTLP_SPAN_KIND.PRODUCER:
			return "producer";
		case OTLP_SPAN_KIND.CONSUMER:
			return "consumer";
		default:
			return "internal";
	}
}

/**
 * A normalized span with timing relative to test start.
 * This is our internal representation used for rendering.
 */
export interface NormalizedSpan {
	/** Unique span ID from OTLP */
	id: string;
	/** Parent span ID, or null for root spans */
	parentId: string | null;
	/** Trace ID this span belongs to */
	traceId: string;
	/** Original span name from OTLP (e.g., "playwright.test.step", "HTTP GET") */
	name: string;
	/** Display title (e.g., test.step.title attribute, or span name as fallback) */
	title: string;
	/** Start time in milliseconds, relative to test start */
	startOffsetMs: number;
	/** Duration in milliseconds */
	durationMs: number;
	/** Span kind for visual styling */
	kind: SpanKind;
	/** Original attributes from OTLP, flattened to simple values */
	attributes: Record<string, string | number | boolean>;
}

/**
 * Well-known attribute keys for extracting display title.
 */
const TITLE_ATTRIBUTES = [
	"test.step.title", // Playwright step title
	"test.case.title", // Playwright test title
] as const;

/**
 * Extracts a simple value from an OTLP attribute.
 * OTLP attributes have a union type for the value field.
 */
function extractAttributeValue(
	attr: OtlpAttribute,
): string | number | boolean | undefined {
	const { value } = attr;
	if (value.stringValue !== undefined) return value.stringValue;
	if (value.intValue !== undefined) return value.intValue;
	if (value.doubleValue !== undefined) return value.doubleValue;
	if (value.boolValue !== undefined) return value.boolValue;
	return undefined;
}

/**
 * Converts OTLP attributes array to a simple key-value record.
 */
function flattenAttributes(
	attrs: OtlpAttribute[],
): Record<string, string | number | boolean> {
	const result: Record<string, string | number | boolean> = {};
	for (const attr of attrs) {
		const value = extractAttributeValue(attr);
		if (value !== undefined) {
			result[attr.key] = value;
		}
	}
	return result;
}

/**
 * Extracts a display title from attributes, falling back to span name.
 */
function extractTitle(
	attrs: Record<string, string | number | boolean>,
	spanName: string,
): string {
	for (const key of TITLE_ATTRIBUTES) {
		const value = attrs[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return spanName;
}

/**
 * Converts nanosecond timestamp string to milliseconds number.
 * OTLP uses string representation to preserve precision for nanoseconds.
 */
function nanoToMs(nanoStr: string): number {
	// Use BigInt for precision, then convert to number for ms
	const nanos = BigInt(nanoStr);
	return Number(nanos / BigInt(1_000_000));
}

/**
 * Normalizes a single OTLP span to our internal format.
 *
 * @param span - The OTLP span to normalize
 * @param testStartTimeMs - Test start time in milliseconds (for relative offset calculation)
 * @returns Normalized span with relative timing
 */
export function normalizeSpan(
	span: OtlpSpan,
	testStartTimeMs: number,
): NormalizedSpan {
	const attributes = flattenAttributes(span.attributes);
	const startTimeMs = nanoToMs(span.startTimeUnixNano);
	const endTimeMs = nanoToMs(span.endTimeUnixNano);

	return {
		id: span.spanId,
		parentId: span.parentSpanId ?? null,
		traceId: span.traceId,
		name: span.name,
		title: extractTitle(attributes, span.name),
		startOffsetMs: startTimeMs - testStartTimeMs,
		durationMs: endTimeMs - startTimeMs,
		kind: spanKindFromOtlp(span.kind),
		attributes,
	};
}

/**
 * Extracts all spans from an OTLP trace export and normalizes them.
 *
 * @param otlpExport - The OTLP trace export containing resourceSpans
 * @param testStartTimeMs - Test start time in milliseconds
 * @returns Array of normalized spans, sorted by start time
 */
export function normalizeOtlpExport(
	otlpExport: OtlpTraceExport,
	testStartTimeMs: number,
): NormalizedSpan[] {
	const spans: NormalizedSpan[] = [];

	for (const resourceSpans of otlpExport.resourceSpans) {
		for (const scopeSpans of resourceSpans.scopeSpans) {
			for (const span of scopeSpans.spans) {
				spans.push(normalizeSpan(span, testStartTimeMs));
			}
		}
	}

	// Sort by start time for consistent ordering
	spans.sort((a, b) => a.startOffsetMs - b.startOffsetMs);

	return spans;
}
