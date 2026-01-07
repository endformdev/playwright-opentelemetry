import { describe, expect, it } from "vitest";
import type { Span } from "../trace-data-loader/exportToSpans";
import { detectTestPhases, getTestBodyPhase } from "./detectTestPhases";

function createSpan(overrides: Partial<Span>): Span {
	return {
		id: "span-1",
		parentId: null,
		traceId: "trace-1",
		name: "playwright.test.step",
		title: "Test Step",
		startOffsetMs: 0,
		durationMs: 100,
		kind: "internal",
		attributes: {},
		serviceName: "playwright",
		...overrides,
	};
}

describe("detectTestPhases", () => {
	it("returns null for empty steps", () => {
		expect(detectTestPhases([])).toBeNull();
	});

	it("returns null when there is no root test span", () => {
		const steps: Span[] = [
			createSpan({
				id: "step-1",
				name: "playwright.test.step",
				title: "Some step",
			}),
		];
		expect(detectTestPhases(steps)).toBeNull();
	});

	it("returns null when there are no hooks", () => {
		const steps: Span[] = [
			createSpan({
				id: "root",
				name: "playwright.test",
				title: "My Test",
				startOffsetMs: 0,
				durationMs: 1000,
			}),
			createSpan({
				id: "step-1",
				parentId: "root",
				name: "playwright.test.step",
				title: "Click button",
				startOffsetMs: 0,
				durationMs: 500,
			}),
		];
		expect(detectTestPhases(steps)).toBeNull();
	});

	it("detects before hooks phase", () => {
		const steps: Span[] = [
			createSpan({
				id: "root",
				name: "playwright.test",
				title: "My Test",
				startOffsetMs: 0,
				durationMs: 1000,
			}),
			createSpan({
				id: "before",
				parentId: "root",
				name: "playwright.test.step",
				title: "before hooks",
				startOffsetMs: 0,
				durationMs: 200,
			}),
			createSpan({
				id: "step-1",
				parentId: "root",
				name: "playwright.test.step",
				title: "Click button",
				startOffsetMs: 200,
				durationMs: 800,
			}),
		];

		const phases = detectTestPhases(steps);
		expect(phases).not.toBeNull();
		expect(phases).toHaveLength(2);

		expect(phases![0]).toEqual({
			type: "before-hooks",
			startMs: 0,
			endMs: 200,
			label: "Before Hooks",
		});
		expect(phases![1]).toEqual({
			type: "test-body",
			startMs: 200,
			endMs: 1000,
			label: "Test Body",
		});
	});

	it("detects after hooks phase", () => {
		const steps: Span[] = [
			createSpan({
				id: "root",
				name: "playwright.test",
				title: "My Test",
				startOffsetMs: 0,
				durationMs: 1000,
			}),
			createSpan({
				id: "step-1",
				parentId: "root",
				name: "playwright.test.step",
				title: "Click button",
				startOffsetMs: 0,
				durationMs: 700,
			}),
			createSpan({
				id: "after",
				parentId: "root",
				name: "playwright.test.step",
				title: "after hooks",
				startOffsetMs: 700,
				durationMs: 300,
			}),
		];

		const phases = detectTestPhases(steps);
		expect(phases).not.toBeNull();
		expect(phases).toHaveLength(2);

		expect(phases![0]).toEqual({
			type: "test-body",
			startMs: 0,
			endMs: 700,
			label: "Test Body",
		});
		expect(phases![1]).toEqual({
			type: "after-hooks",
			startMs: 700,
			endMs: 1000,
			label: "After Hooks",
		});
	});

	it("detects all three phases", () => {
		const steps: Span[] = [
			createSpan({
				id: "root",
				name: "playwright.test",
				title: "My Test",
				startOffsetMs: 0,
				durationMs: 1000,
			}),
			createSpan({
				id: "before",
				parentId: "root",
				name: "playwright.test.step",
				title: "before hooks",
				startOffsetMs: 0,
				durationMs: 100,
			}),
			createSpan({
				id: "step-1",
				parentId: "root",
				name: "playwright.test.step",
				title: "Click button",
				startOffsetMs: 100,
				durationMs: 600,
			}),
			createSpan({
				id: "after",
				parentId: "root",
				name: "playwright.test.step",
				title: "after hooks",
				startOffsetMs: 700,
				durationMs: 300,
			}),
		];

		const phases = detectTestPhases(steps);
		expect(phases).not.toBeNull();
		expect(phases).toHaveLength(3);

		expect(phases![0]).toEqual({
			type: "before-hooks",
			startMs: 0,
			endMs: 100,
			label: "Before Hooks",
		});
		expect(phases![1]).toEqual({
			type: "test-body",
			startMs: 100,
			endMs: 700,
			label: "Test Body",
		});
		expect(phases![2]).toEqual({
			type: "after-hooks",
			startMs: 700,
			endMs: 1000,
			label: "After Hooks",
		});
	});

	it("handles case-insensitive hook titles", () => {
		const steps: Span[] = [
			createSpan({
				id: "root",
				name: "playwright.test",
				title: "My Test",
				startOffsetMs: 0,
				durationMs: 1000,
			}),
			createSpan({
				id: "before",
				parentId: "root",
				name: "playwright.test.step",
				title: "Before Hooks",
				startOffsetMs: 0,
				durationMs: 100,
			}),
			createSpan({
				id: "after",
				parentId: "root",
				name: "playwright.test.step",
				title: "AFTER HOOKS",
				startOffsetMs: 700,
				durationMs: 300,
			}),
		];

		const phases = detectTestPhases(steps);
		expect(phases).not.toBeNull();
		expect(phases).toHaveLength(3);
		expect(phases![0].type).toBe("before-hooks");
		expect(phases![2].type).toBe("after-hooks");
	});
});

describe("getTestBodyPhase", () => {
	it("returns null for null phases", () => {
		expect(getTestBodyPhase(null)).toBeNull();
	});

	it("returns null when no test body exists", () => {
		const phases = [
			{
				type: "before-hooks" as const,
				startMs: 0,
				endMs: 100,
				label: "Before Hooks",
			},
		];
		expect(getTestBodyPhase(phases)).toBeNull();
	});

	it("returns the test body phase", () => {
		const phases = [
			{
				type: "before-hooks" as const,
				startMs: 0,
				endMs: 100,
				label: "Before Hooks",
			},
			{
				type: "test-body" as const,
				startMs: 100,
				endMs: 700,
				label: "Test Body",
			},
			{
				type: "after-hooks" as const,
				startMs: 700,
				endMs: 1000,
				label: "After Hooks",
			},
		];

		const testBody = getTestBodyPhase(phases);
		expect(testBody).not.toBeNull();
		expect(testBody!.type).toBe("test-body");
		expect(testBody!.startMs).toBe(100);
		expect(testBody!.endMs).toBe(700);
	});
});
