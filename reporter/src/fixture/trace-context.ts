import type { TestInfo } from "@playwright/test";
import {
	generateSpanId,
	generateTraceId,
	sendSpans,
	type Span,
	type SpanEvent,
} from "../shared/otel";
import type { ResolvedPlaywrightOpentelemetryConfig } from "../shared/config";

export const TRACE_CONTEXT_ATTACHMENT_NAME =
	"playwright-opentelemetry-trace-context";
export const FIXTURE_SPANS_ATTACHMENT_NAME =
	"playwright-opentelemetry-fixture-spans";
export const RRWEB_RECORDINGS_ATTACHMENT_NAME =
	"playwright-opentelemetry-rrweb-recordings";

export interface PlaywrightOtelTraceContextAttachment {
	traceId: string;
	rootSpanId: string;
}

export type FixtureSpan = Omit<Span, "events"> & {
	events: SpanEvent[];
};

export interface PlaywrightOtelFixtureSpansAttachment {
	spans: Array<
		Omit<FixtureSpan, "startTime" | "endTime" | "events"> & {
			startTime: string;
			endTime: string;
			events: Array<Omit<SpanEvent, "time"> & { time: string }>;
		}
	>;
}

export interface NetworkRequestTraceContext {
	traceId: string;
	spanId: string;
	parentSpanId: string;
	routeAssociation: "active-route" | "active-page" | "root";
}

export interface TestTraceContext extends PlaywrightOtelTraceContextAttachment {
	spans: FixtureSpan[];
	requestContexts: WeakMap<object, NetworkRequestTraceContext>;
	addSpan(span: FixtureSpan): void;
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
	testInfo?: Pick<TestInfo, "attach">,
): Promise<void> {
	if (traceContext.spans.length === 0) {
		return;
	}

	if (config.storeTraceZip && testInfo) {
		await testInfo.attach(FIXTURE_SPANS_ATTACHMENT_NAME, {
			body: JSON.stringify({
				spans: traceContext.spans.map(serializeSpanForAttachment),
			}),
			contentType: "application/json",
		});
	}

	const destinations = fixtureSpanDestinations(config);
	if (destinations.length === 0) {
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

function serializeSpanForAttachment(
	span: FixtureSpan,
): PlaywrightOtelFixtureSpansAttachment["spans"][number] {
	return {
		...span,
		startTime: span.startTime.toISOString(),
		endTime: span.endTime.toISOString(),
		events: span.events.map((event) => ({
			...event,
			time: event.time.toISOString(),
		})),
	};
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
