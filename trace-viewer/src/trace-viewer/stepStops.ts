import type { Span } from "../trace-data-loader/exportToSpans";

/**
 * A position the step viewer can be moved to with the arrow keys: a time on
 * the timeline paired with the step it belongs to.
 */
export interface StepStop {
	/** Time to lock, relative to test start */
	timeMs: number;
	stepId: string;
	/** Whether this stop is at the start or the end of the step */
	edge: "start" | "end";
}

const HOOK_PHASES = new Set(["before", "after"]);
const HOOK_CONTAINER_TITLES = new Set(["before hooks", "after hooks"]);
const EXCLUDED_CATEGORIES = new Set(["hook", "fixture"]);

/**
 * Steps the viewer walks through: the leaves of the test body's step tree,
 * in start order. Hooks, fixtures and the steps inside them are skipped, and
 * grouping steps are represented by their children.
 */
export function getSteppableSteps(steps: Span[]): Span[] {
	const stepsById = new Map(steps.map((step) => [step.id, step]));
	const isInHooks = (step: Span): boolean => {
		for (
			let current: Span | undefined = step;
			current;
			current = current.parentId ? stepsById.get(current.parentId) : undefined
		) {
			if (HOOK_PHASES.has(String(current.attributes["playwright.test.phase"])))
				return true;
			if (
				current.name === "playwright.test.step" &&
				HOOK_CONTAINER_TITLES.has(current.title.toLowerCase())
			)
				return true;
		}
		return false;
	};

	const candidates = steps.filter(
		(step) =>
			step.name === "playwright.test.step" &&
			!EXCLUDED_CATEGORIES.has(String(step.attributes["test.step.category"])) &&
			!isInHooks(step),
	);
	const parentIds = new Set(candidates.map((step) => step.parentId));

	return candidates
		.filter((step) => !parentIds.has(step.id))
		.sort((a, b) => a.startOffsetMs - b.startOffsetMs);
}

/**
 * Builds the ordered stops for the step viewer: the start and the end of each
 * step, so every stop answers "this is the page as this step began / ended".
 * A step without duration gets a single stop.
 */
export function computeStepStops(steps: Span[]): StepStop[] {
	const stops: StepStop[] = [];
	for (const step of getSteppableSteps(steps)) {
		const startMs = step.startOffsetMs;
		const endMs = step.startOffsetMs + step.durationMs;
		stops.push({ timeMs: startMs, stepId: step.id, edge: "start" });
		if (endMs > startMs) {
			stops.push({ timeMs: endMs, stepId: step.id, edge: "end" });
		}
	}
	return stops;
}

/** Index of the stop exactly matching a locked time and step, if any. */
export function findStopIndex(
	stops: StepStop[],
	timeMs: number,
	stepId: string | undefined,
): number | null {
	const index = stops.findIndex(
		(stop) => stop.timeMs === timeMs && stop.stepId === stepId,
	);
	return index === -1 ? null : index;
}

/**
 * The stop to move to from the current position. From an exact stop this is
 * the neighbouring stop; from any other locked time it is the nearest stop in
 * that direction; with nothing locked it is the first stop.
 */
export function getAdjacentStopIndex(
	stops: StepStop[],
	current: { timeMs: number; stepId: string | undefined } | null,
	direction: -1 | 1,
): number | null {
	if (stops.length === 0) return null;
	if (!current) return 0;

	const exact = findStopIndex(stops, current.timeMs, current.stepId);
	if (exact !== null) {
		return Math.max(0, Math.min(stops.length - 1, exact + direction));
	}

	if (direction === 1) {
		const next = stops.findIndex((stop) => stop.timeMs > current.timeMs);
		return next === -1 ? stops.length - 1 : next;
	}
	const previous = findLastStopIndex(
		stops,
		(stop) => stop.timeMs < current.timeMs,
	);
	return previous ?? 0;
}

/**
 * The stop that best represents a locked time: the last stop at or before
 * it, falling back to the first stop.
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
