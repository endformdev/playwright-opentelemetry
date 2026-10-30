import path from "node:path";
import type { TestCase, TestResult, TestStep } from "@playwright/test/reporter";
import { TRACE_CONTEXT_ATTACHMENT_NAME } from "../fixture/trace-context";
import type {
	ResolvedPlaywrightOpentelemetryConfig,
	ResolvedPlaywrightOpentelemetryDestination,
} from "../shared/config";
import { filterLiveDestinations } from "../shared/destinations";
import {
	type LiveTraceEnded,
	type LiveTraceRoute,
	sendLiveTraceRequest,
} from "../shared/live-trace";
import { buildOtlpRequest, generateSpanId, type Span } from "../shared/otel";
import { ATTR_CODE_FILE_PATH, ATTR_CODE_LINE_NUMBER } from "./otel-attributes";
import {
	ATTR_TEST_PHASE,
	ATTR_TEST_STEP_CATEGORY,
	ATTR_TEST_STEP_NAME,
	ATTR_TEST_STEP_TITLE,
	TEST_SPAN_NAME,
	TEST_STEP_SPAN_NAME,
} from "./reporter-attributes";
import {
	errorStatus,
	isInternalApiRequestStep,
	isInternalFixtureStep,
	testSpanAttributes,
} from "./test-steps";

const STEP_FLUSH_INTERVAL_MS = 250;

interface TraceContext {
	traceId: string;
	rootSpanId: string;
}

interface LiveTestState {
	destinations: ResolvedPlaywrightOpentelemetryDestination[];
	/** Read from the fixture's attachment, which arrives once it has set up. */
	traceContext?: TraceContext;
	stepSpanIds: WeakMap<TestStep, string>;
	endedSteps: TestStep[];
	stepsStartTime?: Date;
	stepsEndTime?: Date;
	flushTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Streams step spans to live trace destinations as each step ends, then the
 * test span and final status once the test ends. The fixture creates the live
 * trace and streams the browser and network spans.
 */
export class LiveTestStreamer {
	private readonly tests = new WeakMap<TestResult, LiveTestState>();
	private readonly inFlight = new Set<Promise<void>>();

	constructor(
		private readonly rootDir: () => string | undefined,
		private readonly playwrightVersion: () => string,
	) {}

	onTestBegin(
		result: TestResult,
		config: ResolvedPlaywrightOpentelemetryConfig,
	): void {
		const destinations = filterLiveDestinations(
			config.playwrightTraceApiDestinations,
		);
		if (destinations.length === 0) return;

		this.tests.set(result, {
			destinations,
			stepSpanIds: new WeakMap(),
			endedSteps: [],
		});
	}

	onStepBegin(result: TestResult, step: TestStep): void {
		// IDs are assigned up front so children, which end first, know them.
		this.tests.get(result)?.stepSpanIds.set(step, generateSpanId());
	}

	onStepEnd(result: TestResult, step: TestStep): void {
		const state = this.tests.get(result);
		if (!state || isSkippedStep(step)) return;

		state.endedSteps.push(step);
		state.flushTimer ??= setTimeout(
			() => this.flushSteps(result, state),
			STEP_FLUSH_INTERVAL_MS,
		);
	}

	onTestEnd(test: TestCase, result: TestResult): void {
		const state = this.tests.get(result);
		if (!state) return;
		this.tests.delete(result);

		clearTimeout(state.flushTimer);
		const traceContext = resolveTraceContext(state, result);
		// Without the fixture's trace context there is no live trace to end.
		if (!traceContext) return;

		const stepSpans = this.takeStepSpans(state, traceContext);
		const startTime = earliest(result.startTime, state.stepsStartTime);
		const endTime = latest(
			new Date(result.startTime.getTime() + result.duration),
			state.stepsEndTime,
		);
		const testSpan: Span = {
			traceId: traceContext.traceId,
			spanId: traceContext.rootSpanId,
			name: TEST_SPAN_NAME,
			startTime,
			endTime,
			attributes: testSpanAttributes(test, result, this.rootDir()),
		};
		if (result.status !== test.expectedStatus) {
			testSpan.status = { code: 2 };
		}

		const ended: LiveTraceEnded = {
			status: result.status,
			endTime: endTime.getTime(),
		};
		this.track(
			this.send(state, traceContext, "spans", [...stepSpans, testSpan]).then(
				() => this.send(state, traceContext, "end", JSON.stringify(ended)),
			),
		);
	}

	async onEnd(): Promise<void> {
		await Promise.all(this.inFlight);
	}

	private flushSteps(result: TestResult, state: LiveTestState): void {
		state.flushTimer = undefined;
		const traceContext = resolveTraceContext(state, result);
		if (!traceContext) {
			// Steps from before the fixture set up wait for its trace context.
			state.flushTimer = setTimeout(
				() => this.flushSteps(result, state),
				STEP_FLUSH_INTERVAL_MS,
			);
			return;
		}

		const spans = this.takeStepSpans(state, traceContext);
		this.track(this.send(state, traceContext, "spans", spans));
	}

	private takeStepSpans(
		state: LiveTestState,
		traceContext: TraceContext,
	): Span[] {
		const spans = state.endedSteps.map((step) =>
			this.stepSpan(state, traceContext, step),
		);
		state.endedSteps = [];

		for (const span of spans) {
			state.stepsStartTime = earliest(span.startTime, state.stepsStartTime);
			state.stepsEndTime = latest(span.endTime, state.stepsEndTime);
		}
		return spans;
	}

	private stepSpan(
		state: LiveTestState,
		traceContext: TraceContext,
		step: TestStep,
	): Span {
		// Skipped steps don't get spans, so their children attach to the
		// nearest step that does, or to the test.
		const ancestors: TestStep[] = [];
		for (let parent = step.parent; parent; parent = parent.parent) {
			if (!isSkippedStep(parent)) ancestors.unshift(parent);
		}
		const parent = ancestors.at(-1);

		const attributes: Span["attributes"] = {
			[ATTR_TEST_STEP_NAME]: [...ancestors, step]
				.map((ancestor) => ancestor.title)
				.join(" > "),
			[ATTR_TEST_STEP_TITLE]: step.title,
			[ATTR_TEST_STEP_CATEGORY]: step.category,
		};
		const phase = stepPhase([...ancestors, step]);
		if (phase) attributes[ATTR_TEST_PHASE] = phase;

		if (step.location) {
			const rootDir = this.rootDir();
			attributes[ATTR_CODE_FILE_PATH] = rootDir
				? path.relative(rootDir, step.location.file)
				: step.location.file;
			attributes[ATTR_CODE_LINE_NUMBER] = step.location.line;
		}

		const span: Span = {
			traceId: traceContext.traceId,
			spanId: state.stepSpanIds.get(step) ?? generateSpanId(),
			parentSpanId:
				(parent && state.stepSpanIds.get(parent)) ?? traceContext.rootSpanId,
			name: TEST_STEP_SPAN_NAME,
			startTime: step.startTime,
			endTime: new Date(step.startTime.getTime() + step.duration),
			attributes,
		};
		if (step.error) {
			span.status = errorStatus(step.error.message);
		}
		return span;
	}

	private async send(
		state: LiveTestState,
		traceContext: TraceContext,
		route: LiveTraceRoute,
		body: Span[] | string,
	): Promise<void> {
		if (Array.isArray(body) && body.length === 0) return;

		const payload = Array.isArray(body)
			? JSON.stringify(buildOtlpRequest(body, this.playwrightVersion()))
			: body;
		const failures = await Promise.all(
			state.destinations.map((destination) =>
				sendLiveTraceRequest(destination, traceContext.traceId, route, payload),
			),
		);
		for (const failure of failures) {
			if (failure) {
				console.warn(
					`Live trace ${traceContext.traceId} export failed: ${failure}`,
				);
			}
		}
	}

	private track(request: Promise<void>): void {
		this.inFlight.add(request);
		void request.finally(() => this.inFlight.delete(request));
	}
}

function isSkippedStep(step: TestStep): boolean {
	return isInternalFixtureStep(step) || isInternalApiRequestStep(step);
}

/** Same phases as the end-of-test export: the nearest hook group wins. */
function stepPhase(steps: TestStep[]): "before" | "after" | undefined {
	let phase: "before" | "after" | undefined;
	for (const step of steps) {
		if (step.category !== "hook") continue;
		if (step.title === "Before Hooks") phase = "before";
		if (step.title === "After Hooks" || step.title === "Worker Cleanup") {
			phase = "after";
		}
	}
	return phase;
}

function resolveTraceContext(
	state: LiveTestState,
	result: TestResult,
): TraceContext | undefined {
	if (state.traceContext) return state.traceContext;

	const attachment = result.attachments.find(
		(attachment) => attachment.name === TRACE_CONTEXT_ATTACHMENT_NAME,
	);
	if (!attachment?.body) return undefined;

	state.traceContext = JSON.parse(
		attachment.body.toString("utf-8"),
	) as TraceContext;
	return state.traceContext;
}

function earliest(date: Date, other: Date | undefined): Date {
	return other && other < date ? other : date;
}

function latest(date: Date, other: Date | undefined): Date {
	return other && other > date ? other : date;
}
