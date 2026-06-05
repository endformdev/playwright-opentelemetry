import type { TestInfo } from "@playwright/test";
import {
	generateSpanId,
	generateTraceId,
	parseOtlpHeaders,
	sendSpans,
	type Span,
} from "../shared/otel";

export const TRACE_CONTEXT_ATTACHMENT_NAME =
	"playwright-opentelemetry-trace-context";

export interface PlaywrightOtelTraceContextAttachment {
	traceId: string;
	rootSpanId: string;
}

export interface NetworkRequestTraceContext {
	traceId: string;
	spanId: string;
	parentSpanId: string;
	routeAssociation: "active-route" | "active-page" | "root";
}

export interface TestTraceContext extends PlaywrightOtelTraceContextAttachment {
	spans: Span[];
	requestContexts: WeakMap<object, NetworkRequestTraceContext>;
	addSpan(span: Span): void;
}

export async function createTestTraceContext(
	testInfo: TestInfo,
): Promise<TestTraceContext> {
	const traceContext: TestTraceContext = {
		traceId: generateTraceId(),
		rootSpanId: generateSpanId(),
		spans: [],
		requestContexts: new WeakMap<object, NetworkRequestTraceContext>(),
		addSpan(span) {
			this.spans.push(span);
		},
	};

	await testInfo.attach(TRACE_CONTEXT_ATTACHMENT_NAME, {
		body: JSON.stringify({
			traceId: traceContext.traceId,
			rootSpanId: traceContext.rootSpanId,
		}),
		contentType: "application/json",
	});

	return traceContext;
}

export async function flushFixtureSpans(
	traceContext: TestTraceContext,
): Promise<void> {
	const destinations = fixtureSpanDestinations();
	if (traceContext.spans.length === 0 || destinations.length === 0) {
		return;
	}

	await Promise.all(
		destinations.map((destination) =>
			sendSpans(traceContext.spans, {
				tracesEndpoint: destination.tracesEndpoint,
				headers: destination.headers,
				serviceName: "playwright-browser",
				playwrightVersion: "unknown",
				debug: process.env.PLAYWRIGHT_OPENTELEMETRY_DEBUG === "1",
			}),
		),
	);
}

function fixtureSpanDestinations(): Array<{
	tracesEndpoint: string;
	headers: Record<string, string>;
}> {
	const destinations: Array<{
		tracesEndpoint: string;
		headers: Record<string, string>;
	}> = [];

	if (process.env.PLAYWRIGHT_TRACE_API_ENDPOINT) {
		destinations.push({
			tracesEndpoint: `${process.env.PLAYWRIGHT_TRACE_API_ENDPOINT}/v1/traces`,
			headers: parseOtlpHeaders(process.env.PLAYWRIGHT_TRACE_API_HEADERS),
		});
	}

	if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
		destinations.push({
			tracesEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
			headers: parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
		});
	}

	return destinations;
}
