import { describe, expect, it } from "vitest";
import type { Span } from "../trace-data-loader/exportToSpans";
import { buildTestStructure, getStepAncestry } from "./testStructure";

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
	it("counts the test's requests as steps of its body", () => {
		const structure = buildTestStructure([
			root,
			createStep({ id: "call", title: "Call the API", durationMs: 300 }),
			createStep({
				id: "request",
				parentId: "call",
				name: "HTTP GET",
				attributes: { "http.request.method": "GET" },
				durationMs: 200,
			}),
			createStep({
				id: "check",
				parentId: "call",
				startOffsetMs: 200,
				durationMs: 100,
			}),
			createStep({
				id: "other",
				name: "some.span",
				startOffsetMs: 400,
			}),
		]);

		expect(ids(structure.bodySteps)).toEqual(["call", "request", "check"]);
		expect(ids(structure.bodyLeafSteps)).toEqual(["request", "check"]);
	});

	it("leaves out requests made in the hooks", () => {
		const structure = buildTestStructure([
			root,
			createStep({ id: "before", title: "Before Hooks", durationMs: 200 }),
			createStep({
				id: "request",
				name: "HTTP GET",
				attributes: { "http.request.method": "GET" },
				startOffsetMs: 50,
			}),
			createStep({
				id: "after",
				title: "After Hooks",
				startOffsetMs: 4000,
				durationMs: 200,
			}),
			createStep({
				id: "teardown",
				name: "HTTP GET",
				attributes: { "http.request.method": "GET" },
				startOffsetMs: 4100,
			}),
		]);

		expect(ids(structure.bodySteps)).toEqual([]);
	});

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

describe("getStepAncestry", () => {
	const group = createStep({ id: "group", title: "Login" });
	const click = createStep({ id: "click", parentId: "group", title: "Click" });
	const spansById = new Map(
		[root, group, click].map((span) => [span.id, span]),
	);

	it("lists the step's ancestors outermost first, ending with the step", () => {
		expect(ids(getStepAncestry("click", spansById))).toEqual([
			"root",
			"group",
			"click",
		]);
	});

	it("is empty for an unknown step", () => {
		expect(getStepAncestry("missing", spansById)).toEqual([]);
	});

	it("stops at a parent that is not in the trace", () => {
		const orphan = createStep({ id: "orphan", parentId: "gone" });
		expect(
			ids(getStepAncestry("orphan", new Map([["orphan", orphan]]))),
		).toEqual(["orphan"]);
	});
});
