import { describe, expect, it } from "vitest";
import type { Span } from "../trace-data-loader/exportToSpans";
import {
	computeStepStops,
	getAdjacentStopIndex,
	getSteppableSteps,
	getStopIndexAtTime,
	type StepStop,
} from "./stepStops";

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

describe("getSteppableSteps", () => {
	it("returns leaf steps of the test body in start order", () => {
		const steps = [
			root,
			createStep({ id: "group", title: "Login", startOffsetMs: 100 }),
			createStep({
				id: "click",
				parentId: "group",
				startOffsetMs: 300,
				attributes: { "test.step.category": "pw:api" },
			}),
			createStep({
				id: "fill",
				parentId: "group",
				startOffsetMs: 100,
				attributes: { "test.step.category": "pw:api" },
			}),
			createStep({ id: "expect", startOffsetMs: 1000 }),
		];

		expect(getSteppableSteps(steps).map((step) => step.id)).toEqual([
			"fill",
			"click",
			"expect",
		]);
	});

	it("skips hooks by phase attribute and by container title", () => {
		const steps = [
			root,
			createStep({ id: "before", title: "Before Hooks", durationMs: 200 }),
			createStep({
				id: "before-each",
				parentId: "before",
				attributes: { "test.step.category": "hook" },
			}),
			createStep({
				id: "goto-in-hook",
				parentId: "before-each",
				attributes: { "playwright.test.phase": "before" },
			}),
			createStep({ id: "body-step", startOffsetMs: 300 }),
			createStep({
				id: "after",
				title: "After Hooks",
				startOffsetMs: 4000,
			}),
			createStep({ id: "cleanup", parentId: "after", startOffsetMs: 4000 }),
		];

		expect(getSteppableSteps(steps).map((step) => step.id)).toEqual([
			"body-step",
		]);
	});

	it("treats a group whose only children are fixtures as a leaf", () => {
		const steps = [
			root,
			createStep({ id: "group" }),
			createStep({
				id: "fixture",
				parentId: "group",
				attributes: { "test.step.category": "fixture" },
			}),
		];

		expect(getSteppableSteps(steps).map((step) => step.id)).toEqual(["group"]);
	});
});

describe("computeStepStops", () => {
	it("stops at the start and end of each step", () => {
		const steps = [
			root,
			createStep({ id: "a", startOffsetMs: 100, durationMs: 400 }),
			createStep({ id: "b", startOffsetMs: 600, durationMs: 400 }),
		];

		expect(computeStepStops(steps)).toEqual([
			{ timeMs: 100, stepId: "a", edge: "start" },
			{ timeMs: 500, stepId: "a", edge: "end" },
			{ timeMs: 600, stepId: "b", edge: "start" },
			{ timeMs: 1000, stepId: "b", edge: "end" },
		]);
	});

	it("stops once at steps without duration", () => {
		const steps = [
			root,
			createStep({ id: "a", startOffsetMs: 100, durationMs: 0 }),
		];

		expect(computeStepStops(steps)).toEqual([
			{ timeMs: 100, stepId: "a", edge: "start" },
		]);
	});
});

describe("getAdjacentStopIndex", () => {
	const stops: StepStop[] = [
		{ timeMs: 100, stepId: "a", edge: "start" },
		{ timeMs: 200, stepId: "a", edge: "end" },
		{ timeMs: 200, stepId: "b", edge: "start" },
		{ timeMs: 400, stepId: "c", edge: "start" },
	];

	it("starts at the first stop when nothing is locked", () => {
		expect(getAdjacentStopIndex(stops, null, 1)).toBe(0);
		expect(getAdjacentStopIndex(stops, null, -1)).toBe(0);
	});

	it("moves between stops that share a time by step", () => {
		expect(getAdjacentStopIndex(stops, { timeMs: 200, stepId: "a" }, 1)).toBe(
			2,
		);
		expect(getAdjacentStopIndex(stops, { timeMs: 200, stepId: "b" }, -1)).toBe(
			1,
		);
	});

	it("clamps at both ends", () => {
		expect(getAdjacentStopIndex(stops, { timeMs: 100, stepId: "a" }, -1)).toBe(
			0,
		);
		expect(getAdjacentStopIndex(stops, { timeMs: 400, stepId: "c" }, 1)).toBe(
			3,
		);
	});

	it("moves to the nearest stop from a time that is not a stop", () => {
		expect(
			getAdjacentStopIndex(stops, { timeMs: 300, stepId: undefined }, 1),
		).toBe(3);
		expect(
			getAdjacentStopIndex(stops, { timeMs: 300, stepId: undefined }, -1),
		).toBe(2);
	});
});

describe("getStopIndexAtTime", () => {
	it("returns the last stop at or before the time", () => {
		const stops: StepStop[] = [
			{ timeMs: 100, stepId: "a", edge: "start" },
			{ timeMs: 300, stepId: "b", edge: "start" },
		];

		expect(getStopIndexAtTime(stops, 50)).toBe(0);
		expect(getStopIndexAtTime(stops, 250)).toBe(0);
		expect(getStopIndexAtTime(stops, 300)).toBe(1);
		expect(getStopIndexAtTime([], 300)).toBeNull();
	});
});
