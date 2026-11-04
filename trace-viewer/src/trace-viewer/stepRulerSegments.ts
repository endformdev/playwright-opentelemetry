import type { Span } from "../trace-data-loader/exportToSpans";
import { getPlayingStopIndex, type StepStop } from "./stepStops";
import { formatTimeLabel } from "./timelineScale";
import type { TestStructure } from "./testStructure";

/** A test body step on the step ruler: one per step viewer stop. */
export interface StepRulerStep {
	kind: "step";
	/** The step viewer stop this step finishes at */
	stopIndex: number;
	step: Span;
	/** Drawn range, relative to test start */
	startMs: number;
	endMs: number;
}

/** The before or after hooks, drawn hatched at the ends of the step ruler. */
export interface StepRulerHooks {
	kind: "before-hooks" | "after-hooks";
	startMs: number;
	endMs: number;
}

export type StepRulerItem = StepRulerStep | StepRulerHooks;

export interface StepRulerSegments {
	steps: StepRulerStep[];
	hooks: StepRulerHooks[];
}

export type StepRulerSegmentState = "done" | "current" | "upcoming";

/**
 * Lays out the step ruler: a segment per stop's step, in stop order, and the
 * hooks at either end. Steps that ran at the same time would sit on top of
 * each other, so each starts no earlier than the one before it ended.
 */
export function computeStepRulerSegments(
	structure: TestStructure,
	stops: StepStop[],
): StepRulerSegments {
	const stepsById = new Map(
		structure.bodyLeafSteps.map((step) => [step.id, step]),
	);
	const steps: StepRulerStep[] = [];
	let previousEndMs = Number.NEGATIVE_INFINITY;
	stops.forEach((stop, stopIndex) => {
		const step = stepsById.get(stop.stepId);
		if (!step) return;
		const endMs = step.startOffsetMs + step.durationMs;
		const startMs = Math.min(
			endMs,
			Math.max(step.startOffsetMs, previousEndMs),
		);
		previousEndMs = Math.max(previousEndMs, endMs);
		steps.push({ kind: "step", stopIndex, step, startMs, endMs });
	});

	const hooks: StepRulerHooks[] = [];
	for (const [kind, span] of [
		["before-hooks", structure.beforeHooks],
		["after-hooks", structure.afterHooks],
	] as const) {
		if (span) {
			hooks.push({
				kind,
				startMs: span.startOffsetMs,
				endMs: span.startOffsetMs + span.durationMs,
			});
		}
	}

	return { steps, hooks };
}

/**
 * How a step is drawn against the playhead: the step the viewer is on is
 * current, steps that have finished by the playhead are done, the rest are
 * still to come. With nothing locked there is no playhead.
 */
export function getStepRulerSegmentState(
	segment: StepRulerStep,
	playheadMs: number | null,
	currentStopIndex: number | null,
): StepRulerSegmentState {
	if (segment.stopIndex === currentStopIndex) return "current";
	if (playheadMs !== null && segment.endMs <= playheadMs) return "done";
	return "upcoming";
}

/**
 * What the step ruler names at a time: the hooks running then, else the step
 * running or, between steps, the one whose result is on screen (as playback
 * shows it). Before the first step, outside any hooks, it is nothing.
 */
export function getStepRulerItemAtTime(
	segments: StepRulerSegments,
	stops: StepStop[],
	timeMs: number,
): StepRulerItem | null {
	const hooks = segments.hooks.find(
		(hook) => timeMs >= hook.startMs && timeMs <= hook.endMs,
	);
	if (hooks) return hooks;
	if (segments.steps.length === 0) return null;
	const firstStepStartMs = Math.min(
		...segments.steps.map((segment) => segment.step.startOffsetMs),
	);
	const stopIndex = getPlayingStopIndex(stops, timeMs, firstStepStartMs);
	if (stopIndex === null) return null;
	return (
		segments.steps.find((segment) => segment.stopIndex === stopIndex) ?? null
	);
}

const HOOK_LABELS: Record<StepRulerHooks["kind"], string> = {
	"before-hooks": "Before hooks",
	"after-hooks": "After hooks",
};

/** Names a step ruler item: `7. Click getByRole('button')`, `Before hooks`. */
export function formatStepRulerItem(item: StepRulerItem): string {
	if (item.kind !== "step") return HOOK_LABELS[item.kind];
	const subtitle = item.step.subtitle ? ` ${item.step.subtitle}` : "";
	return `${item.stopIndex + 1}. ${item.step.title}${subtitle}`;
}

/** Names a moment: what the ruler names there, then the time. */
export function describeStepRulerTime(
	segments: StepRulerSegments,
	stops: StepStop[],
	timeMs: number,
): string {
	const item = getStepRulerItemAtTime(segments, stops, timeMs);
	const time = formatTimeLabel(timeMs);
	return item ? `${formatStepRulerItem(item)} · ${time}` : time;
}
