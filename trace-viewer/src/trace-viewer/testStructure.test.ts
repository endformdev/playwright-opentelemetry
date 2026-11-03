import { describe, expect, it } from "vitest";
import type { Span } from "../trace-data-loader/exportToSpans";
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

const ids = (spans: Span[]) => spans.map((span) => span.id);

describe("buildTestStructure", () => {
	it("finds the root test and the hook containers", () => {
		const structure = buildTestStructure([
			createStep({ id: "before", title: "Before Hooks" }),
			root,
			createStep({ id: "after", title: "after hooks", startOffsetMs: 4000 }),
		]);

		expect(structure.root?.id).toBe("root");
		expect(structure.beforeHooks?.id).toBe("before");
		expect(structure.afterHooks?.id).toBe("after");
	});

	it("has no root without a parentless playwright.test span", () => {
		const structure = buildTestStructure([createStep({ id: "a" })]);

		expect(structure.root).toBeNull();
		expect(structure.beforeHooks).toBeNull();
	});

	it("lists body steps and their leaves in start order", () => {
		const structure = buildTestStructure([
			root,
			createStep({ id: "group", title: "Login", startOffsetMs: 100 }),
			createStep({ id: "click", parentId: "group", startOffsetMs: 300 }),
			createStep({ id: "fill", parentId: "group", startOffsetMs: 100 }),
			createStep({ id: "expect", startOffsetMs: 1000 }),
		]);

		expect(ids(structure.bodySteps)).toEqual([
			"group",
			"fill",
			"click",
			"expect",
		]);
		expect(ids(structure.bodyLeafSteps)).toEqual(["fill", "click", "expect"]);
	});

	it("leaves out hooks by container and by phase attribute", () => {
		const structure = buildTestStructure([
			root,
			createStep({ id: "before", title: "Before Hooks", durationMs: 200 }),
			createStep({
				id: "before-each",
				parentId: "before",
				attributes: { "test.step.category": "hook" },
			}),
			createStep({ id: "goto-in-hook", parentId: "before-each" }),
			createStep({
				id: "phase-only",
				attributes: { "playwright.test.phase": "after" },
			}),
			createStep({ id: "body-step", startOffsetMs: 300 }),
			createStep({ id: "after", title: "After Hooks", startOffsetMs: 4000 }),
			createStep({ id: "cleanup", parentId: "after", startOffsetMs: 4000 }),
		]);

		expect(ids(structure.bodySteps)).toEqual(["body-step"]);
	});

	it("treats a group whose only children are fixtures as a leaf", () => {
		const structure = buildTestStructure([
			root,
			createStep({ id: "group" }),
			createStep({
				id: "fixture",
				parentId: "group",
				attributes: { "test.step.category": "fixture" },
			}),
		]);

		expect(ids(structure.bodyLeafSteps)).toEqual(["group"]);
	});
});
