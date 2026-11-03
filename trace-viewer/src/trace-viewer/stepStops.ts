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

/** Where the step viewer stands: on a stop, at another time, or nowhere. */
export type StopPosition = { stopIndex: number } | { timeMs: number } | null;

/** Stops sit this far before the next step, so they show the one that ended */
const BEFORE_NEXT_STEP_MS = 1;

/**
 * Builds the ordered stops for the step viewer, one per leaf step of the test
 * body. Each stop shows the step's result: screenshots are taken in the
 * background and a step's effect often reaches the screen after it ends, so
 * a stop waits until just before the next step (or the after hooks) starts,
 * when the page has settled. The last step without anything after it stops
 * at its end.
 */
export function computeStepStops(structure: TestStructure): StepStop[] {
	const { bodyLeafSteps, afterHooks } = structure;
	const nextStepStarts = [
		...bodyLeafSteps.map((step) => step.startOffsetMs),
		...(afterHooks ? [afterHooks.startOffsetMs] : []),
	].sort((a, b) => a - b);

	return bodyLeafSteps
		.map((step) => {
			const endMs = step.startOffsetMs + step.durationMs;
			const nextStartMs = nextStepStarts.find((startMs) => startMs >= endMs);
			const timeMs =
				nextStartMs === undefined
					? endMs
					: Math.max(endMs, nextStartMs - BEFORE_NEXT_STEP_MS);
			return { timeMs, endMs, stepId: step.id };
		})
		.sort((a, b) => a.timeMs - b.timeMs || a.endMs - b.endMs)
		.map(({ timeMs, stepId }) => ({ timeMs, stepId }));
}

/**
 * The stop to move to. From a stop this is its neighbour; from any other time
 * it is the nearest stop in that direction; from nowhere it is the first stop.
 */
export function getAdjacentStopIndex(
	stops: StepStop[],
	from: StopPosition,
	direction: -1 | 1,
): number | null {
	if (stops.length === 0) return null;
	if (!from) return 0;

	if ("stopIndex" in from) {
		return Math.max(0, Math.min(stops.length - 1, from.stopIndex + direction));
	}

	if (direction === 1) {
		const next = stops.findIndex((stop) => stop.timeMs > from.timeMs);
		return next === -1 ? stops.length - 1 : next;
	}
	return findLastStopIndex(stops, (stop) => stop.timeMs < from.timeMs) ?? 0;
}

/**
 * The stop that best represents a time: the last stop at or before it,
 * falling back to the first stop.
 */
export function getStopIndexAtTime(
	stops: StepStop[],
	timeMs: number,
): number | null {
	if (stops.length === 0) return null;
	return findLastStopIndex(stops, (stop) => stop.timeMs <= timeMs) ?? 0;
}

function findLastStopIndex(
	stops: StepStop[],
	predicate: (stop: StepStop) => boolean,
): number | null {
	for (let index = stops.length - 1; index >= 0; index--) {
		if (predicate(stops[index])) return index;
	}
	return null;
}
