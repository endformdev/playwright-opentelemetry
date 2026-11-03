import { describe, expect, it } from "vitest";
import type { Span } from "../trace-data-loader/exportToSpans";
import {
	computeStepStops,
	getAdjacentStopIndex,
	getStopIndexAtTime,
	type StepStop,
} from "./stepStops";
import { buildTestStructure } from "./testStructure";

function createStep(overrides: Partial<Span>): Span {
	return {
		id: "step",
		parentId: "root",
		traceId: "trace-1",
		name: "playwright.test.step",
		title: "Step",
		startOffsetMs: 0,
		durationMs: 100,
		kind: "internal",
		attributes: {},
		serviceName: "playwright",
		...overrides,
	};
}

const root = createStep({
	id: "root",
	parentId: null,
	name: "playwright.test",
	title: "My test",
	durationMs: 5000,
});

describe("computeStepStops", () => {
	it("stops at the start of each leaf step, then where the steps end", () => {
		const structure = buildTestStructure([
			root,
			createStep({ id: "before", title: "Before Hooks", durationMs: 50 }),
			createStep({ id: "group", startOffsetMs: 100, durationMs: 1200 }),
			createStep({
				id: "a",
				parentId: "group",
				startOffsetMs: 100,
				durationMs: 400,
			}),
			createStep({
				id: "b",
				parentId: "group",
				startOffsetMs: 600,
				durationMs: 400,
			}),
			createStep({ id: "after", title: "After Hooks", startOffsetMs: 4000 }),
		]);

		// The group outlasts its last child; the end stop waits for it.
		expect(computeStepStops(structure)).toEqual([
			{ timeMs: 100, stepId: "a", kind: "step" },
			{ timeMs: 600, stepId: "b", kind: "step" },
			{ timeMs: 1300, stepId: "b", kind: "end" },
		]);
	});

	it("ends on the step that finishes last", () => {
		const structure = buildTestStructure([
			root,
			createStep({ id: "long", startOffsetMs: 0, durationMs: 900 }),
			createStep({ id: "short", startOffsetMs: 100, durationMs: 100 }),
		]);

		expect(computeStepStops(structure).at(-1)).toEqual({
			timeMs: 900,
			stepId: "long",
			kind: "end",
		});
	});

	it("has no stops without body steps", () => {
		expect(computeStepStops(buildTestStructure([root]))).toEqual([]);
	});
});

describe("getAdjacentStopIndex", () => {
	const stops: StepStop[] = [
		{ timeMs: 100, stepId: "a", kind: "step" },
		{ timeMs: 200, stepId: "b", kind: "step" },
		{ timeMs: 200, stepId: "c", kind: "step" },
		{ timeMs: 400, stepId: "c", kind: "end" },
	];

	it("starts at the first stop from nowhere, in either direction", () => {
		expect(getAdjacentStopIndex(stops, null, 1)).toBe(0);
		expect(getAdjacentStopIndex(stops, null, -1)).toBe(0);
	});

	it("moves to the neighbouring stop, even at the same time", () => {
		expect(getAdjacentStopIndex(stops, { stopIndex: 1 }, 1)).toBe(2);
		expect(getAdjacentStopIndex(stops, { stopIndex: 2 }, -1)).toBe(1);
	});

	it("clamps at both ends", () => {
		expect(getAdjacentStopIndex(stops, { stopIndex: 0 }, -1)).toBe(0);
		expect(getAdjacentStopIndex(stops, { stopIndex: 3 }, 1)).toBe(3);
	});

	it("moves to the nearest stop from a time that is not a stop", () => {
		expect(getAdjacentStopIndex(stops, { timeMs: 300 }, 1)).toBe(3);
		expect(getAdjacentStopIndex(stops, { timeMs: 300 }, -1)).toBe(2);
		expect(getAdjacentStopIndex(stops, { timeMs: 50 }, -1)).toBe(0);
		expect(getAdjacentStopIndex(stops, { timeMs: 500 }, 1)).toBe(3);
	});

	it("has nowhere to go without stops", () => {
		expect(getAdjacentStopIndex([], null, 1)).toBeNull();
	});
});

describe("getStopIndexAtTime", () => {
	it("returns the last stop at or before the time", () => {
		const stops: StepStop[] = [
			{ timeMs: 100, stepId: "a", kind: "step" },
			{ timeMs: 300, stepId: "b", kind: "step" },
		];

		expect(getStopIndexAtTime(stops, 50)).toBe(0);
		expect(getStopIndexAtTime(stops, 250)).toBe(0);
		expect(getStopIndexAtTime(stops, 300)).toBe(1);
		expect(getStopIndexAtTime([], 300)).toBeNull();
	});
});
