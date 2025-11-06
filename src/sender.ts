import type { Span } from "./reporter";

export interface SendSpansOptions {
	endpoint: string;
	headers?: Record<string, string>;
}

// Convert span attributes to OTLP format
function toOtlpAttributes(
	attributes: Array<{
		key: string;
		value: { stringValue?: string; intValue?: number; boolValue?: boolean };
	}>,
) {
	return attributes.map((attr) => ({
		key: attr.key,
		value: attr.value,
	}));
}

// Build the OTLP trace export request
function buildOtlpRequest(spans: Span[]) {
	const otlpSpans = spans.map((span) => ({
		traceId: span.traceId,
		spanId: span.spanId,
		parentSpanId: span.parentSpanId || undefined,
		name: span.name,
		kind: span.kind,
		startTimeUnixNano: span.startTimeUnixNano,
		endTimeUnixNano: span.endTimeUnixNano,
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
						{ key: "service.name", value: { stringValue: "playwright-tests" } },
						{
							key: "service.namespace",
							value: { stringValue: "playwright" },
						},
					],
				},
				scopeSpans: [
					{
						scope: {
							name: "playwright-opentelemetry",
							version: "1.0.0",
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
	options?: SendSpansOptions,
): Promise<void> {
	if (spans.length === 0) {
		return;
	}

	const endpoint = options?.endpoint || "http://localhost:4318/v1/traces";
	const headers = options?.headers || {};

	const body = JSON.stringify(buildOtlpRequest(spans));

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
