import type { Span } from "../trace-data-loader/exportToSpans";
import type { StepStop } from "./stepStops";
import { formatTimeLabel } from "./timelineScale";
import type { TestStructure } from "./testStructure";

/**
 * A stretch of time a test body step has the ruler. Usually a step has one,
 * from its start to its end; a step sharing time with shorter ones has one
 * either side of them.
 */
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

/**
 * Lays out the step ruler, which decides which step a moment belongs to.
 * Steps only have the time they ran for. When several ran at once the one
 * that finishes first has that time, so a short step shows while it runs and
 * the longer one it ran alongside comes back after it. In time between steps
 * nothing has the ruler; see getStepSegmentAtTime.
 */
export function computeStepRulerSegments(
	structure: TestStructure,
	stops: StepStop[],
): StepRulerSegments {
	const stepsById = new Map(
		structure.bodyLeafSteps.map((step) => [step.id, step]),
	);
	// In stop order, which is the order they finish.
	const ran = stops.flatMap((stop, stopIndex) => {
		const step = stepsById.get(stop.stepId);
		if (!step) return [];
		const startMs = step.startOffsetMs;
		return [{ stopIndex, step, startMs, endMs: startMs + step.durationMs }];
	});
	const edgesMs = [...new Set(ran.flatMap((s) => [s.startMs, s.endMs]))].sort(
		(a, b) => a - b,
	);

	const steps: StepRulerStep[] = [];
	edgesMs.slice(0, -1).forEach((startMs, index) => {
		const endMs = edgesMs[index + 1];
		const running = ran.find(
			(candidate) => candidate.startMs <= startMs && candidate.endMs >= endMs,
		);
		if (!running) return;
		const previous = steps.at(-1);
		if (
			previous?.stopIndex === running.stopIndex &&
			previous.endMs === startMs
		) {
			previous.endMs = endMs;
		} else {
			steps.push({ kind: "step", ...running, startMs, endMs });
		}
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
 * The step at a time: the segment there, or between steps the last one
 * before it, whose result is on screen. Null before the first step. A time
 * two segments meet at belongs to the one ending, as a stop at a step's end
 * shows that step.
 */
export function getStepSegmentAtTime(
	steps: StepRulerStep[],
	timeMs: number,
): StepRulerStep | null {
	let latest: StepRulerStep | null = null;
	for (const segment of steps) {
		if (segment.startMs > timeMs) break;
		latest = segment;
		if (timeMs <= segment.endMs) break;
	}
	return latest;
}

/** What the step ruler names at a time: the hooks running, or the step. */
export function getStepRulerItemAtTime(
	segments: StepRulerSegments,
	timeMs: number,
): StepRulerItem | null {
	const hooks = segments.hooks.find(
		(hook) => timeMs >= hook.startMs && timeMs <= hook.endMs,
	);
	return hooks ?? getStepSegmentAtTime(segments.steps, timeMs);
}

const HOOK_LABELS: Record<StepRulerHooks["kind"], string> = {
	"before-hooks": "Before hooks",
	"after-hooks": "After hooks",
};

/** Names a step ruler item: `7. Click getByRole('button')`, `Before hooks`. */
function formatStepRulerItem(item: StepRulerItem): string {
	if (item.kind !== "step") return HOOK_LABELS[item.kind];
	const subtitle = item.step.subtitle ? ` ${item.step.subtitle}` : "";
	return `${item.stopIndex + 1}. ${item.step.title}${subtitle}`;
}

/** Names a moment: what the ruler names there, then the time. */
export function describeStepRulerTime(
	segments: StepRulerSegments,
	timeMs: number,
): string {
	const item = getStepRulerItemAtTime(segments, timeMs);
	const time = formatTimeLabel(timeMs);
	return item ? `${formatStepRulerItem(item)} · ${time}` : time;
}
