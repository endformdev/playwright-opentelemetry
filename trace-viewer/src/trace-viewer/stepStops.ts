import type { TestStructure } from "./testStructure";

/**
 * A position the step viewer can be moved to: the moment just after a step,
 * showing what it did.
 */
export interface StepStop {
	/** Time to lock, relative to test start */
	timeMs: number;
	/** The step that has just finished here */
	stepId: string;
}

/** Stops sit this far before the next step, so they show the one that ended */
const BEFORE_NEXT_STEP_MS = 1;

/**
 * Builds the ordered stops for the step viewer, one per leaf step of the test
 * body, in the order they finish. Each stop shows the step's result:
 * screenshots are taken in the background and a step's effect often reaches
 * the screen after it ends, so a stop waits until just before the next step
 * (or the after hooks) starts, when the page has settled. With another step
 * still running there is no such pause, and neither is there after the last
 * step, so those stop where the step ends.
 */
export function computeStepStops(structure: TestStructure): StepStop[] {
	const { bodyLeafSteps, afterHooks } = structure;
	const nextStepStarts = [
		...bodyLeafSteps.map((step) => step.startOffsetMs),
		...(afterHooks ? [afterHooks.startOffsetMs] : []),
	].sort((a, b) => a - b);
	const endOf = (step: { startOffsetMs: number; durationMs: number }) =>
		step.startOffsetMs + step.durationMs;

	return bodyLeafSteps
		.map((step) => {
			const endMs = endOf(step);
			const anotherStillRunning = bodyLeafSteps.some(
				(other) => other.startOffsetMs <= endMs && endOf(other) > endMs,
			);
			const nextStartMs = nextStepStarts.find((startMs) => startMs >= endMs);
			const timeMs =
				anotherStillRunning || nextStartMs === undefined
					? endMs
					: Math.max(endMs, nextStartMs - BEFORE_NEXT_STEP_MS);
			return { timeMs, endMs, stepId: step.id };
		})
		.sort((a, b) => a.timeMs - b.timeMs || a.endMs - b.endMs)
		.map(({ timeMs, stepId }) => ({ timeMs, stepId }));
}

/**
 * The stop to move to: the neighbour of the stop the step viewer is on, staying
 * put at the ends, or the first stop from before any of them.
 */
export function getAdjacentStopIndex(
	stops: StepStop[],
	fromIndex: number | null,
	direction: -1 | 1,
): number | null {
	if (stops.length === 0) return null;
	if (fromIndex === null) return 0;
	return Math.max(0, Math.min(stops.length - 1, fromIndex + direction));
}
