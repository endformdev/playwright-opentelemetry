import type { TestInfo } from "@playwright/test";
import {
	generateSpanId,
	generateTraceId,
	sendSpans,
	type Span,
} from "../shared/otel";
import type { ResolvedPlaywrightOpentelemetryConfig } from "../shared/config";

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
	config: ResolvedPlaywrightOpentelemetryConfig,
): Promise<void> {
	const destinations = fixtureSpanDestinations(config);
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
				debug: config.debug,
			}),
		),
	);
}

function fixtureSpanDestinations(
	config: ResolvedPlaywrightOpentelemetryConfig,
): Array<{
	tracesEndpoint: string;
	headers: Record<string, string>;
}> {
	const destinations: Array<{
		tracesEndpoint: string;
		headers: Record<string, string>;
	}> = [];

	if (config.playwrightTraceApiEndpoint) {
		destinations.push({
			tracesEndpoint: `${config.playwrightTraceApiEndpoint}/v1/traces`,
			headers: config.playwrightTraceApiHeaders,
		});
	}

	if (config.otlpEndpoint) {
		destinations.push({
			tracesEndpoint: config.otlpEndpoint,
			headers: config.otlpHeaders,
		});
	}

	return destinations;
}
