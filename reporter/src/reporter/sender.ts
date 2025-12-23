import { version } from "../../package.json" with { type: "json" };
import type { Span } from "./reporter";

export interface SendSpansOptions {
	tracesEndpoint: string;
	headers?: Record<string, string>;
	serviceName: string;
	playwrightVersion: string;
	debug?: boolean;
}

// Convert Date to nanoseconds for OTLP format
function dateToNanoseconds(date: Date): string {
	return (BigInt(date.getTime()) * BigInt(1_000_000)).toString();
}

// Convert simple attributes to OTLP format
function toOtlpAttributes(
	attributes: Record<string, string | number | boolean>,
) {
	return Object.entries(attributes).map(([key, value]) => {
		if (typeof value === "number") {
			return {
				key,
				value: Number.isInteger(value)
					? { intValue: value }
					: { doubleValue: value },
			};
		} else if (typeof value === "boolean") {
			return {
				key,
				value: { boolValue: value },
			};
		} else {
			return {
				key,
				value: { stringValue: value },
			};
		}
	});
}

// SPAN_KIND_INTERNAL = 1
const SPAN_KIND_INTERNAL = 1;

// Build the OTLP trace export request
export function buildOtlpRequest(
	spans: Span[],
	serviceName: string,
	playwrightVersion: string,
) {
	const otlpSpans = spans.map((span) => ({
		traceId: span.traceId,
		spanId: span.spanId,
		parentSpanId: span.parentSpanId || undefined,
		name: span.name,
		kind: SPAN_KIND_INTERNAL,
		startTimeUnixNano: dateToNanoseconds(span.startTime),
		endTimeUnixNano: dateToNanoseconds(span.endTime),
		attributes: toOtlpAttributes(span.attributes),
		droppedAttributesCount: 0,
		events: [],
		droppedEventsCount: 0,
		status: span.status,
		links: [],
		droppedLinksCount: 0,
	}));

	return {
		resourceSpans: [
			{
				resource: {
					attributes: [
						{
							key: "service.name",
							value: { stringValue: serviceName },
						},
						{
							key: "service.namespace",
							value: { stringValue: "playwright" },
						},
						{
							key: "service.version",
							value: { stringValue: playwrightVersion },
						},
					],
				},
				scopeSpans: [
					{
						scope: {
							name: "playwright-opentelemetry",
							version,
						},
						spans: otlpSpans,
					},
				],
			},
		],
	};
}

export async function sendSpans(
	spans: Span[],
	options: SendSpansOptions,
): Promise<void> {
	if (spans.length === 0) {
		return;
	}

	const endpoint = options.tracesEndpoint;
	const headers = options.headers || {};

	const body = JSON.stringify(
		buildOtlpRequest(spans, options.serviceName, options.playwrightVersion),
	);

	if (options.debug) {
		console.log("Sending spans to", endpoint);
		// pretty print the body
		// console.log(JSON.stringify(JSON.parse(body), null, 2));
	}

	const response = await fetch(endpoint, {
		method: "POST",
		body,
		headers: {
			"content-type": "application/json",
			...headers,
		},
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(
			`Failed to send spans: ${response.status} ${response.statusText}, ${error}`,
		);
	}
}
