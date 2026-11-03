import type { Span } from "../trace-data-loader/exportToSpans";
import type { TestStructure } from "./testStructure";

/**
 * A position the step viewer can be moved to: a time on the timeline and the
 * step shown there.
 */
export interface StepStop {
	/** Time to lock, relative to test start */
	timeMs: number;
	/** The step starting here; at the end stop, the step that finished last */
	stepId: string;
	/** A step's start, or the end of the test body's steps */
	kind: "step" | "end";
}

/** Where the step viewer stands: on a stop, at another time, or nowhere. */
export type StopPosition = { stopIndex: number } | { timeMs: number } | null;

/**
 * Builds the ordered stops for the step viewer: the start of each leaf step
 * of the test body, then one stop where the body's steps have all finished.
 */
export function computeStepStops(structure: TestStructure): StepStop[] {
	const stops: StepStop[] = structure.bodyLeafSteps.map((step) => ({
		timeMs: step.startOffsetMs,
		stepId: step.id,
		kind: "step",
	}));

	const endOf = (step: Span) => step.startOffsetMs + step.durationMs;
	const lastLeaf = structure.bodyLeafSteps.reduce<Span | null>(
		(last, step) => (!last || endOf(step) >= endOf(last) ? step : last),
		null,
	);
	if (lastLeaf) {
		const bodyEndMs = Math.max(...structure.bodySteps.map(endOf));
		stops.push({ timeMs: bodyEndMs, stepId: lastLeaf.id, kind: "end" });
	}
	return stops;
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
