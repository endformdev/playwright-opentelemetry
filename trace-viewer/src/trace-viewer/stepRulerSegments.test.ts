import { describe, expect, it } from "vitest";
import type { Span } from "../trace-data-loader/exportToSpans";
import {
	computeStepRulerSegments,
	formatStepRulerItem,
	getStepRulerItemAtTime,
	getStepRulerSegmentState,
	getStepSegmentAtTime,
} from "./stepRulerSegments";
import { computeStepStops } from "./stepStops";
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

function layout(steps: Span[]) {
	const structure = buildTestStructure([root, ...steps]);
	const stops = computeStepStops(structure);
	return { stops, segments: computeStepRulerSegments(structure, stops) };
}

const hookedTest = layout([
	createStep({ id: "before", title: "Before Hooks", durationMs: 400 }),
	createStep({
		id: "goto",
		title: "Navigate",
		subtitle: "playwright.dev",
		startOffsetMs: 500,
		durationMs: 500,
	}),
	createStep({ id: "click", title: "Click", startOffsetMs: 1500 }),
	createStep({
		id: "after",
		title: "After Hooks",
		startOffsetMs: 4000,
		durationMs: 600,
	}),
]);

describe("computeStepRulerSegments", () => {
	it("draws each stop's step over the time it ran, with the hooks at the ends", () => {
		expect(
			hookedTest.segments.steps.map(({ stopIndex, step, startMs, endMs }) => ({
				stopIndex,
				id: step.id,
				startMs,
				endMs,
			})),
		).toEqual([
			{ stopIndex: 0, id: "goto", startMs: 500, endMs: 1000 },
			{ stopIndex: 1, id: "click", startMs: 1500, endMs: 1600 },
		]);
		expect(hookedTest.segments.hooks).toEqual([
			{ kind: "before-hooks", startMs: 0, endMs: 400 },
			{ kind: "after-hooks", startMs: 4000, endMs: 4600 },
		]);
	});

	it("gives shared time to the step that finishes first, then back", () => {
		const { segments } = layout([
			createStep({ id: "first", startOffsetMs: 0, durationMs: 1000 }),
			createStep({ id: "second", startOffsetMs: 500, durationMs: 1000 }),
			createStep({ id: "inside", startOffsetMs: 600, durationMs: 100 }),
		]);
		expect(
			segments.steps.map(({ step, startMs, endMs }) => [
				step.id,
				startMs,
				endMs,
			]),
		).toEqual([
			["first", 0, 600],
			["inside", 600, 700],
			["first", 700, 1000],
			["second", 1000, 1500],
		]);
	});

	it("leaves the time between steps to no one", () => {
		const { segments } = layout([
			createStep({ id: "a", startOffsetMs: 0, durationMs: 100 }),
			createStep({ id: "b", startOffsetMs: 300, durationMs: 100 }),
		]);
		expect(
			segments.steps.map(({ startMs, endMs }) => [startMs, endMs]),
		).toEqual([
			[0, 100],
			[300, 400],
		]);
	});

	it("has no segments for a test without steps or hooks", () => {
		expect(layout([]).segments).toEqual({ steps: [], hooks: [] });
	});
});

describe("getStepRulerSegmentState", () => {
	const [goto, click] = hookedTest.segments.steps;

	it("marks steps finished by the playhead as done, the rest as upcoming", () => {
		expect(getStepRulerSegmentState(goto, 1000, null)).toBe("done");
		expect(getStepRulerSegmentState(click, 1000, null)).toBe("upcoming");
	});

	it("marks the step the viewer is on as current", () => {
		expect(getStepRulerSegmentState(goto, 1499, 0)).toBe("current");
		expect(getStepRulerSegmentState(click, 1499, 0)).toBe("upcoming");
	});

	it("leaves every step upcoming without a playhead", () => {
		expect(getStepRulerSegmentState(goto, null, null)).toBe("upcoming");
	});
});

describe("getStepRulerItemAtTime", () => {
	const { segments } = hookedTest;
	const itemAt = (timeMs: number) => {
		const item = getStepRulerItemAtTime(segments, timeMs);
		return item && (item.kind === "step" ? item.step.id : item.kind);
	};

	it("names the hooks running", () => {
		expect(itemAt(200)).toBe("before-hooks");
		expect(itemAt(4300)).toBe("after-hooks");
	});

	it("names the step running, or between steps the one on screen", () => {
		expect(itemAt(700)).toBe("goto");
		expect(itemAt(1200)).toBe("goto");
		expect(itemAt(1550)).toBe("click");
		expect(itemAt(3000)).toBe("click");
	});

	it("is nothing before the first step outside the hooks", () => {
		expect(itemAt(450)).toBeNull();
	});
});

describe("getStepSegmentAtTime", () => {
	const { segments } = layout([
		createStep({ id: "long", startOffsetMs: 100, durationMs: 800 }),
		createStep({ id: "short", startOffsetMs: 200, durationMs: 100 }),
		createStep({ id: "later", startOffsetMs: 1200, durationMs: 100 }),
	]);
	const stepAt = (timeMs: number) =>
		getStepSegmentAtTime(segments.steps, timeMs)?.step.id ?? null;

	it("is nothing before the first step", () => {
		expect(stepAt(99)).toBeNull();
	});

	it("follows the steps running, back to a longer one after a shorter", () => {
		expect(stepAt(150)).toBe("long");
		expect(stepAt(250)).toBe("short");
		expect(stepAt(350)).toBe("long");
	});

	it("stays on the last step finished until the next starts", () => {
		expect(stepAt(1000)).toBe("long");
		expect(stepAt(1250)).toBe("later");
		expect(stepAt(4000)).toBe("later");
	});

	it("gives a time two segments meet at to the one ending", () => {
		expect(stepAt(300)).toBe("short");
	});
});

describe("formatStepRulerItem", () => {
	it("numbers steps as the step counter does, followed by their locator", () => {
		const [goto, click] = hookedTest.segments.steps;
		expect(formatStepRulerItem(goto)).toBe("1. Navigate playwright.dev");
		expect(formatStepRulerItem(click)).toBe("2. Click");
	});

	it("names the hooks", () => {
		expect(formatStepRulerItem(hookedTest.segments.hooks[0])).toBe(
			"Before hooks",
		);
	});
});
