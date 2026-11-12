import { isErrorSpan, type Span } from "../trace-data-loader/exportToSpans";
import type { TestStructure } from "./testStructure";

const STEP_SPAN_NAME = "playwright.test.step";

const endOf = (span: Span) => span.startOffsetMs + span.durationMs;

/** The span that ends last, the later starter of a tie; null with none */
function lastToEnd(spans: Span[]): Span | null {
	let last: Span | null = null;
	for (const span of spans) {
		if (
			!last ||
			endOf(span) > endOf(last) ||
			(endOf(span) === endOf(last) && span.startOffsetMs > last.startOffsetMs)
		) {
			last = span;
		}
	}
	return last;
}

/**
 * The step a test that didn't pass failed at, which the viewer opens on.
 *
 * A step that throws fails every step it is nested in, so a failure is a chain
 * of failed steps; the innermost one is where it happened (the expect, not the
 * `test.step` around it). A test can have several chains: soft assertions and
 * caught errors fail a step without stopping the test, and a failing teardown
 * fails the After Hooks as well. The test body comes before the hooks, and
 * within either the chain that ends last is the one that stopped the test.
 *
 * Requests that got an error response aren't steps that failed: the test may
 * have expected them. When no step failed, as when the test body threw on its
 * own, the test failed after its last step, so that is the one returned.
 */
export function findFailingStep(
	steps: Span[],
	structure: TestStructure,
): Span | null {
	const { root } = structure;
	const failedSteps = steps.filter(
		(step) =>
			step !== root && step.name === STEP_SPAN_NAME && isErrorSpan(step),
	);
	const failedIds = new Set(failedSteps.map((step) => step.id));
	const failedChildren = new Map<string, Span[]>();
	for (const step of failedSteps) {
		if (!step.parentId) continue;
		const siblings = failedChildren.get(step.parentId) ?? [];
		siblings.push(step);
		failedChildren.set(step.parentId, siblings);
	}

	// Where each chain starts: below a step that didn't fail, or the test
	const chainStarts = failedSteps.filter(
		(step) =>
			!step.parentId ||
			step.parentId === root?.id ||
			!failedIds.has(step.parentId),
	);
	const bodyIds = new Set(structure.bodySteps.map((step) => step.id));
	const bodyStarts = chainStarts.filter((step) => bodyIds.has(step.id));
	let failing = lastToEnd(bodyStarts.length > 0 ? bodyStarts : chainStarts);
	if (!failing) return lastToEnd(structure.bodyLeafSteps);

	for (
		let inner = lastToEnd(failedChildren.get(failing.id) ?? []);
		inner;
		inner = lastToEnd(failedChildren.get(failing.id) ?? [])
	) {
		failing = inner;
	}
	return failing;
}
