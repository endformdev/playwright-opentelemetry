import { version } from "../../package.json" with { type: "json" };

export type SpanAttributeValue = string | number | boolean | string[];

export type SpanEvent = {
	name: string;
	time: Date;
	attributes?: Record<string, SpanAttributeValue>;
};

export type Span = {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	startTime: Date;
	endTime: Date;
	attributes: Record<string, SpanAttributeValue>;
	events?: SpanEvent[];
	status?: { code: number; message?: string };
	kind?: number;
	/** Service name for this span (if different from default). */
	serviceName?: string;
};

export interface SendSpansOptions {
	tracesEndpoint: string;
	headers?: Record<string, string>;
	playwrightVersion: string;
	debug?: boolean;
}

export const PLAYWRIGHT_TESTS_SERVICE_NAME = "playwright-tests";

/** Generate a random 32-character hex trace ID. */
export function generateTraceId(): string {
	return Array.from({ length: 32 }, () =>
		Math.floor(Math.random() * 16).toString(16),
	).join("");
}

/** Generate a random 16-character hex span ID. */
export function generateSpanId(): string {
	return Array.from({ length: 16 }, () =>
		Math.floor(Math.random() * 16).toString(16),
	).join("");
}

export function parseOtlpHeaders(
	headersString: string | undefined,
): Record<string, string> {
	const headers: Record<string, string> = {};
	if (!headersString) {
		return headers;
	}

	for (const pair of headersString.split(",")) {
		const [key, ...valueParts] = pair.split("=");
		if (key && valueParts.length > 0) {
			headers[key.trim()] = valueParts.join("=").trim();
		}
	}
	return headers;
}

function dateToNanoseconds(date: Date): string {
	return (BigInt(date.getTime()) * BigInt(1_000_000)).toString();
}

function toOtlpAttributes(attributes: Record<string, SpanAttributeValue>) {
	return Object.entries(attributes).map(([key, value]) => {
		if (Array.isArray(value)) {
			return {
				key,
				value: {
					arrayValue: {
						values: value.map((item) => ({ stringValue: item })),
					},
				},
			};
		}

		if (typeof value === "number") {
			return {
				key,
				value: Number.isInteger(value)
					? { intValue: value }
					: { doubleValue: value },
			};
		}

		if (typeof value === "boolean") {
			return {
				key,
				value: { boolValue: value },
			};
		}

		return {
			key,
			value: { stringValue: value },
		};
	});
}

const SPAN_KIND_INTERNAL = 1;

function buildResourceSpan(
	spans: Span[],
	serviceName: string,
	playwrightVersion: string,
) {
	const otlpSpans = spans.map((span) => ({
		traceId: span.traceId,
		spanId: span.spanId,
		parentSpanId: span.parentSpanId || undefined,
		name: span.name,
		kind: span.kind ?? SPAN_KIND_INTERNAL,
		startTimeUnixNano: dateToNanoseconds(span.startTime),
		endTimeUnixNano: dateToNanoseconds(span.endTime),
		attributes: toOtlpAttributes(span.attributes),
		droppedAttributesCount: 0,
		events: (span.events ?? []).map((event) => ({
			name: event.name,
			timeUnixNano: dateToNanoseconds(event.time),
			attributes: toOtlpAttributes(event.attributes ?? {}),
			droppedAttributesCount: 0,
		})),
		droppedEventsCount: 0,
		status: span.status,
		links: [],
		droppedLinksCount: 0,
	}));

	return {
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
	};
}

export function buildOtlpRequest(
	spans: Span[],
	playwrightVersion: string,
) {
	const spansByService = new Map<string, Span[]>();

	for (const span of spans) {
		const spanServiceName = span.serviceName ?? PLAYWRIGHT_TESTS_SERVICE_NAME;
		const serviceSpans = spansByService.get(spanServiceName);
		if (serviceSpans) {
			serviceSpans.push(span);
		} else {
			spansByService.set(spanServiceName, [span]);
		}
	}

	const resourceSpans = [];
	for (const [svcName, svcSpans] of spansByService) {
		resourceSpans.push(buildResourceSpan(svcSpans, svcName, playwrightVersion));
	}

	return { resourceSpans };
}

export async function sendSpans(
	spans: Span[],
	options: SendSpansOptions,
): Promise<void> {
	if (spans.length === 0) {
		return;
	}

	const body = JSON.stringify(
		buildOtlpRequest(spans, options.playwrightVersion),
	);

	if (options.debug) {
		console.log("Sending spans to", options.tracesEndpoint);
	}

	const response = await fetch(options.tracesEndpoint, {
		method: "POST",
		body,
		headers: {
			"content-type": "application/json",
			...(options.headers || {}),
		},
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(
			`Failed to send spans: ${response.status} ${response.statusText}, ${error}`,
		);
	}
}
