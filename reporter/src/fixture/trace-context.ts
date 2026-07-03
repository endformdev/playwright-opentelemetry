import type { TestInfo } from "@playwright/test";
import type { PlaywrightTraceOption } from "../shared/playwright-trace";
import {
	generateSpanId,
	generateTraceId,
	sendSpans,
	type Span,
	type SpanEvent,
	withPlaywrightTraceApiHeaders,
} from "../shared/otel";
import type { ResolvedPlaywrightOpentelemetryConfig } from "../shared/config";
import { shouldRetainPlaywrightTrace } from "../shared/playwright-trace";

export const TRACE_CONTEXT_ATTACHMENT_NAME =
	"playwright-opentelemetry-trace-context";
export const FIXTURE_SPANS_ATTACHMENT_NAME =
	"playwright-opentelemetry-fixture-spans";
export const BROWSER_SERVICE_NAME = "playwright-browser";

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

type FlushFixtureSpansOptions = {
	trace: PlaywrightTraceOption | undefined;
	testInfo?: Pick<TestInfo, "attach" | "expectedStatus" | "retry" | "status">;
};

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

export async function registerExpectedTrace(
	traceContext: TestTraceContext,
	config: ResolvedPlaywrightOpentelemetryConfig,
): Promise<void> {
	const destinations = config.playwrightTraceApiDestinations.filter(
		(destination) => destination.url,
	);

	if (destinations.length === 0) {
		return;
	}

	const failures = await Promise.all(
		destinations.map(async (destination) => {
			try {
				const response = await fetch(
					`${destination.url}/playwright-otel-reporter/v1/expected-trace`,
					{
						method: "PUT",
						headers: withPlaywrightTraceApiHeaders({
							...destination.headers,
							"x-trace-id": traceContext.traceId,
						}),
					},
				);

				if (!response.ok) {
					const error = await response.text();
					return `${destination.url}: ${response.status} ${response.statusText}, ${error}`;
				}
			} catch (error) {
				return `${destination.url}: ${error instanceof Error ? error.message : String(error)}`;
			}
		}),
	);

	for (const failure of failures) {
		if (failure) {
			console.warn(
				`Failed to register expected Playwright trace ${traceContext.traceId}: ${failure}`,
			);
		}
	}
}

export async function flushFixtureSpans(
	traceContext: TestTraceContext,
	config: ResolvedPlaywrightOpentelemetryConfig,
	options: FlushFixtureSpansOptions,
): Promise<void> {
	if (traceContext.spans.length === 0) {
		return;
	}

	const shouldRetainTrace = (trace: PlaywrightTraceOption | null) =>
		shouldRetainPlaywrightTrace(trace ?? options.trace, options.testInfo);

	if (
		config.storeTraceZip &&
		options.testInfo &&
		shouldRetainTrace(config.trace)
	) {
		await options.testInfo.attach(FIXTURE_SPANS_ATTACHMENT_NAME, {
			body: JSON.stringify({
				spans: traceContext.spans.map(serializeSpanForAttachment),
			}),
			contentType: "application/json",
		});
	}

	const destinations = fixtureSpanDestinations(config, shouldRetainTrace);
	if (destinations.length === 0) {
		return;
	}

	await Promise.all(
		destinations.map((destination) =>
			sendSpans(traceContext.spans, {
				tracesEndpoint: destination.tracesEndpoint,
				headers: destination.headers,
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
	shouldRetainTrace: (trace: PlaywrightTraceOption | null) => boolean,
): Array<{
	tracesEndpoint: string;
	headers: Record<string, string>;
}> {
	const destinations: Array<{
		tracesEndpoint: string;
		headers: Record<string, string>;
	}> = [];

	for (const destination of config.playwrightTraceApiDestinations) {
		if (
			!destination.url ||
			!shouldRetainTrace(destination.trace ?? config.trace)
		) {
			continue;
		}

		destinations.push({
			tracesEndpoint: `${destination.url}/v1/traces`,
			headers: withPlaywrightTraceApiHeaders(destination.headers),
		});
	}

	for (const destination of config.otlpDestinations) {
		if (
			!destination.url ||
			!shouldRetainTrace(destination.trace ?? config.trace)
		) {
			continue;
		}

		destinations.push({
			tracesEndpoint: destination.url,
			headers: destination.headers,
		});
	}

	return destinations;
}
