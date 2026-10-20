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
import type {
	ResolvedPlaywrightOpentelemetryConfig,
	ResolvedPlaywrightOpentelemetryDestination,
} from "../shared/config";
import { filterRetainedDestinations } from "../shared/destinations";
import {
	couldRetainPlaywrightTrace,
	type PlaywrightTracePreTestInfo,
	shouldRetainPlaywrightTrace,
} from "../shared/playwright-trace";

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
	/** Sends the spans after the test instead of making its teardown wait for them. */
	exporter?: WorkerTraceExporter;
};

type RegisterExpectedTraceOptions = {
	trace: PlaywrightTraceOption | undefined;
	testInfo?: PlaywrightTracePreTestInfo;
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
	traceId: string = generateTraceId(),
): Promise<TestTraceContext> {
	const traceContext: TestTraceContext = {
		traceId,
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

// Enough registrations ahead that tests faster than a Trace API round trip don't wait
const PREPARED_TRACE_IDS = 3;

/**
 * Worker-scoped helper that keeps the fixture's Trace API calls off each test's
 * critical path. A test takes a trace ID whose expected-trace marker was
 * registered while earlier tests ran, and its fixture spans are sent while the
 * next test runs. The worker's first test still waits for one registration,
 * and markers prepared for tests that never run are left unused.
 */
export class WorkerTraceExporter {
	private prepared: Array<{
		traceId: string;
		key: string;
		registration: Promise<void>;
	}> = [];
	private readonly pending = new Set<Promise<unknown>>();

	async takeTraceId(
		config: ResolvedPlaywrightOpentelemetryConfig,
		options: RegisterExpectedTraceOptions,
	): Promise<string> {
		const destinations = expectedTraceDestinations(config, options);
		const key = destinationsKey(destinations);
		if (this.prepared[0]?.key !== key) {
			this.prepared = [];
		}
		const prepared = this.prepared.shift();

		// Most tests in a worker share destinations, so register upcoming ones now
		while (
			destinations.length > 0 &&
			this.prepared.length < PREPARED_TRACE_IDS
		) {
			const traceId = generateTraceId();
			this.prepared.push({
				traceId,
				key,
				registration: this.track(
					registerExpectedTraceId(traceId, destinations),
				),
			});
		}

		if (prepared) {
			await prepared.registration;
			return prepared.traceId;
		}
		const traceId = generateTraceId();
		await registerExpectedTraceId(traceId, destinations);
		return traceId;
	}

	sendInBackground(sending: Promise<unknown>): void {
		this.track(
			sending.catch((error) => {
				console.warn(
					`Failed to send Playwright fixture spans: ${error instanceof Error ? error.message : String(error)}`,
				);
			}),
		);
	}

	/** Waits for the calls still in flight, giving up after `timeoutMs`. */
	async drain(timeoutMs: number): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timedOut = new Promise<"timeout">((resolve) => {
			timer = setTimeout(() => resolve("timeout"), timeoutMs);
		});
		try {
			while (this.pending.size > 0) {
				const result = await Promise.race([
					Promise.all(this.pending),
					timedOut,
				]);
				if (result === "timeout") {
					console.warn(
						`Gave up waiting for ${this.pending.size} Playwright trace export(s) after ${timeoutMs}ms`,
					);
					return;
				}
			}
		} finally {
			clearTimeout(timer);
		}
	}

	private track<T>(promise: Promise<T>): Promise<T> {
		this.pending.add(promise);
		void promise.finally(() => this.pending.delete(promise));
		return promise;
	}
}

export async function registerExpectedTrace(
	traceContext: TestTraceContext,
	config: ResolvedPlaywrightOpentelemetryConfig,
	options: RegisterExpectedTraceOptions,
): Promise<void> {
	await registerExpectedTraceId(
		traceContext.traceId,
		expectedTraceDestinations(config, options),
	);
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

	const sending = Promise.all(
		destinations.map((destination) =>
			sendSpans(traceContext.spans, {
				tracesEndpoint: destination.tracesEndpoint,
				headers: destination.headers,
				playwrightVersion: "unknown",
				debug: config.debug,
			}),
		),
	);
	if (options.exporter) {
		options.exporter.sendInBackground(sending);
		return;
	}
	await sending;
}

function expectedTraceDestinations(
	config: ResolvedPlaywrightOpentelemetryConfig,
	options: RegisterExpectedTraceOptions,
): ResolvedPlaywrightOpentelemetryDestination[] {
	const couldRetainTrace = (trace: PlaywrightTraceOption | null) =>
		couldRetainPlaywrightTrace(trace ?? options.trace, options.testInfo);
	return filterRetainedDestinations(
		config.playwrightTraceApiDestinations,
		config.trace,
		couldRetainTrace,
	);
}

function destinationsKey(
	destinations: ResolvedPlaywrightOpentelemetryDestination[],
): string {
	return JSON.stringify(
		destinations.map((destination) => [destination.url, destination.headers]),
	);
}

async function registerExpectedTraceId(
	traceId: string,
	destinations: ResolvedPlaywrightOpentelemetryDestination[],
): Promise<void> {
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
							"x-trace-id": traceId,
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
				`Failed to register expected Playwright trace ${traceId}: ${failure}`,
			);
		}
	}
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

	for (const destination of filterRetainedDestinations(
		config.playwrightTraceApiDestinations,
		config.trace,
		shouldRetainTrace,
	)) {
		destinations.push({
			tracesEndpoint: `${destination.url}/v1/traces`,
			headers: withPlaywrightTraceApiHeaders(destination.headers),
		});
	}

	for (const destination of filterRetainedDestinations(
		config.otlpDestinations,
		config.trace,
		shouldRetainTrace,
	)) {
		destinations.push({
			tracesEndpoint: destination.url,
			headers: destination.headers,
		});
	}

	return destinations;
}
