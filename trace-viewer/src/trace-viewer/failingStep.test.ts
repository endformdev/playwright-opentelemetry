import { describe, expect, it } from "vitest";
import type { Span } from "../trace-data-loader/exportToSpans";
import { findFailingStep } from "./failingStep";
import { buildTestStructure } from "./testStructure";

const FAILED = { code: 2, message: "Expected visible" };

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
	durationMs: 10_000,
	status: { code: 2 },
});
const beforeHooks = createStep({
	id: "before",
	title: "Before Hooks",
	durationMs: 500,
	attributes: { "test.step.category": "hook" },
});
const afterHooks = createStep({
	id: "after",
	title: "After Hooks",
	startOffsetMs: 9000,
	durationMs: 1000,
	attributes: { "test.step.category": "hook" },
});

function failingStepId(steps: Span[]): string | null {
	const all = [root, beforeHooks, afterHooks, ...steps];
	return findFailingStep(all, buildTestStructure(all))?.id ?? null;
}

describe("findFailingStep", () => {
	it("finds the innermost of the steps a failure ran through", () => {
		expect(
			failingStepId([
				createStep({ id: "open", startOffsetMs: 600 }),
				createStep({
					id: "checkout",
					title: "Check out",
					startOffsetMs: 800,
					durationMs: 5000,
					status: FAILED,
				}),
				createStep({
					id: "pay",
					parentId: "checkout",
					startOffsetMs: 900,
					durationMs: 200,
				}),
				createStep({
					id: "paid",
					parentId: "checkout",
					startOffsetMs: 1200,
					durationMs: 4600,
					status: FAILED,
				}),
			]),
		).toBe("paid");
	});

	it("takes the failure that stopped the test over earlier soft or caught ones", () => {
		expect(
			failingStepId([
				createStep({
					id: "section",
					startOffsetMs: 600,
					durationMs: 1000,
				}),
				createStep({
					id: "soft",
					parentId: "section",
					startOffsetMs: 700,
					status: FAILED,
				}),
				createStep({
					id: "caught",
					startOffsetMs: 2000,
					status: FAILED,
				}),
				createStep({
					id: "hard",
					startOffsetMs: 3000,
					durationMs: 5000,
					status: FAILED,
				}),
			]),
		).toBe("hard");
	});

	it("takes a failure inside a step that carried on", () => {
		expect(
			failingStepId([
				createStep({ id: "open", startOffsetMs: 600 }),
				createStep({ id: "section", startOffsetMs: 800, durationMs: 1000 }),
				createStep({
					id: "soft",
					parentId: "section",
					startOffsetMs: 900,
					status: FAILED,
				}),
				createStep({ id: "close", startOffsetMs: 2000 }),
			]),
		).toBe("soft");
	});

	it("follows a retried assertion to its last attempt", () => {
		expect(
			failingStepId([
				createStep({
					id: "to-pass",
					startOffsetMs: 600,
					durationMs: 5000,
					status: FAILED,
				}),
				createStep({
					id: "attempt-1",
					parentId: "to-pass",
					startOffsetMs: 700,
					status: FAILED,
				}),
				createStep({
					id: "attempt-2",
					parentId: "to-pass",
					startOffsetMs: 3000,
					status: FAILED,
				}),
			]),
		).toBe("attempt-2");
	});

	it("prefers the test body over a teardown that failed too", () => {
		expect(
			failingStepId([
				createStep({
					id: "check",
					startOffsetMs: 600,
					durationMs: 8000,
					status: FAILED,
				}),
				{ ...afterHooks, status: FAILED },
				createStep({
					id: "teardown",
					parentId: "after",
					startOffsetMs: 9100,
					attributes: { "test.step.category": "fixture" },
					status: FAILED,
				}),
			]),
		).toBe("check");
	});

	it("finds a failing hook when the body didn't fail", () => {
		expect(
			failingStepId([
				{ ...beforeHooks, status: FAILED },
				createStep({
					id: "setup",
					parentId: "before",
					startOffsetMs: 100,
					attributes: { "test.step.category": "fixture" },
					status: FAILED,
				}),
			]),
		).toBe("setup");
	});

	it("doesn't count an error response as a failed step", () => {
		expect(
			failingStepId([
				createStep({
					id: "call",
					startOffsetMs: 600,
					durationMs: 200,
				}),
				createStep({
					id: "request",
					parentId: "call",
					name: "HTTP GET",
					startOffsetMs: 600,
					attributes: { "http.request.method": "GET" },
					status: FAILED,
				}),
				createStep({
					id: "check",
					startOffsetMs: 1000,
					status: FAILED,
				}),
				createStep({
					id: "later-request",
					name: "HTTP GET",
					startOffsetMs: 2000,
					attributes: { "http.request.method": "GET" },
					status: FAILED,
				}),
			]),
		).toBe("check");
	});

	it("falls back to the last step when no step failed", () => {
		expect(
			failingStepId([
				createStep({ id: "first", startOffsetMs: 600 }),
				createStep({ id: "last", startOffsetMs: 1000 }),
			]),
		).toBe("last");
	});
});
