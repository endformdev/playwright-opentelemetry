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

type PlaywrightTraceMode =
	| "off"
	| "on"
	| "retain-on-failure"
	| "on-first-retry"
	| "on-all-retries"
	| "retain-on-first-failure"
	| "retain-on-failure-and-retries"
	| "retain-all-failures";

export type PlaywrightTraceOption =
	| PlaywrightTraceMode
	| "retry-with-trace"
	| { mode?: PlaywrightTraceMode | "retry-with-trace" }
	| undefined;

type FlushFixtureSpansOptions = {
	trace: PlaywrightTraceOption;
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

export async function flushFixtureSpans(
	traceContext: TestTraceContext,
	config: ResolvedPlaywrightOpentelemetryConfig,
	options: FlushFixtureSpansOptions,
): Promise<void> {
	if (traceContext.spans.length === 0) {
		return;
	}

	if (!shouldRetainPlaywrightTrace(options.trace, options.testInfo)) {
		return;
	}

	if (config.storeTraceZip && options.testInfo) {
		await options.testInfo.attach(FIXTURE_SPANS_ATTACHMENT_NAME, {
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

export function shouldRetainPlaywrightTrace(
	trace: PlaywrightTraceOption,
	testInfo?: Pick<TestInfo, "expectedStatus" | "retry" | "status">,
): boolean {
	const mode = normalizeTraceMode(trace);
	const retry = testInfo?.retry ?? 0;
	const testFailed =
		(testInfo?.status ?? "passed") !== (testInfo?.expectedStatus ?? "passed");

	switch (mode) {
		case "on":
			return true;
		case "on-first-retry":
			return retry === 1;
		case "on-all-retries":
			return retry > 0;
		case "retain-on-failure":
			return testFailed;
		case "retain-on-first-failure":
			return retry === 0 && testFailed;
		case "retain-on-failure-and-retries":
			return testFailed || retry > 0;
		case "retain-all-failures":
			return testFailed;
		case "off":
			return false;
	}
}

function normalizeTraceMode(trace: PlaywrightTraceOption): PlaywrightTraceMode {
	const mode = typeof trace === "string" ? trace : (trace?.mode ?? "off");
	return mode === "retry-with-trace" ? "on-first-retry" : mode;
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
