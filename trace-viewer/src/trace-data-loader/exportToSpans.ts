import type { OtlpAttribute, OtlpExport, OtlpSpan } from "./fetchTraceData";

/**
 * A span with timing relative to test start.
 * This is our internal representation used for rendering.
 */
export interface Span {
	id: string;
	parentId: string | null;
	traceId: string;
	/** Original span name from OTLP (e.g., "playwright.test.step", "HTTP GET") */
	name: string;
	/** Display title (e.g., test.step.title attribute, or span name as fallback) */
	title: string;
	/** Start time in milliseconds, relative to test start */
	startOffsetMs: number;
	/** Duration in milliseconds */
	durationMs: number;
	kind: SpanKind;
	attributes: Record<string, string | number | boolean>;
}

export type SpanKind =
	| "internal"
	| "server"
	| "client"
	| "producer"
	| "consumer";

export function otlpExportToSpans(
	otlpExport: OtlpExport,
	testStartTimeMs: number,
): Span[] {
	const spans: Span[] = [];

	for (const resourceSpans of otlpExport.resourceSpans) {
		for (const scopeSpans of resourceSpans.scopeSpans) {
			for (const span of scopeSpans.spans) {
				spans.push(otlpSpanToSpan(span, testStartTimeMs));
			}
		}
	}

	// Sort by start time for consistent ordering
	spans.sort((a, b) => a.startOffsetMs - b.startOffsetMs);

	return spans;
}

/**
 * Converts a single OTLP span to our internal Span format.
 */
export function otlpSpanToSpan(span: OtlpSpan, testStartTimeMs: number): Span {
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

const TITLE_ATTRIBUTES = [
	"test.step.title", // Playwright step title
	"test.case.title", // Playwright test title
] as const;

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

function nanoToMs(nanoStr: string): number {
	// Use BigInt for precision, then convert to number for ms
	const nanos = BigInt(nanoStr);
	return Number(nanos / BigInt(1_000_000));
}
