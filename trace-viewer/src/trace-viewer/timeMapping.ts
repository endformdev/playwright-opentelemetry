import { isErrorSpan, type Span } from "../trace-data-loader/exportToSpans";
import type { StepMatch } from "./stepMatching";
import type { TestStructure } from "./testStructure";

/** What the time mapping needs to know about one run. */
export interface MappedRun {
	structure: TestStructure;
	/** The `playwright.test.step` spans of the test body, as given to matchSteps */
	steps: Span[];
	durationMs: number;
	/** Whether the test passed: a run that didn't may have stopped part way */
	passed: boolean;
}

/** Two times, one in each run, that are the same moment of the test. */
export interface TimeAnchor {
	primaryMs: number;
	comparisonMs: number;
	kind:
		| "test-start"
		| "body-start"
		| "step-start"
		| "step-end"
		| "body-end"
		| "test-end"
		| "settled";
}

export interface TimeMapping {
	anchors: TimeAnchor[];
	/** Whether any step was matched; without one, only the test body is stretched to fit */
	hasStepAnchors: boolean;
	/** The time in the comparison run that is the same moment as this one in the primary */
	comparisonTimeAt(primaryMs: number): number;
}

/**
 * Maps time in the primary run onto the comparison run. Matched steps start
 * and end together; between two anchors time is stretched evenly. With fewer
 * matched steps there are fewer anchors, down to stretching the test body.
 *
 * When either run didn't pass, their ends are not the same moment. From the
 * last shared one the comparison finishes the step it is in and settles:
 * expects don't change the page, so it runs on until its next action, and
 * reaches that as the primary's test body ends.
 */
export function buildTimeMapping(
	primary: MappedRun,
	comparison: MappedRun,
	match: StepMatch,
): TimeMapping {
	const candidates: Candidate[] = [
		{ primaryMs: 0, comparisonMs: 0, kind: "test-start", weight: REQUIRED },
		{
			primaryMs: bodyStartMs(primary),
			comparisonMs: bodyStartMs(comparison),
			kind: "body-start",
			weight: REQUIRED,
		},
	];
	for (const pair of match.pairs) {
		if (pair.outOfOrder) continue;
		candidates.push({
			primaryMs: pair.primary.startOffsetMs,
			comparisonMs: pair.comparison.startOffsetMs,
			kind: "step-start",
			weight: 1,
			comparisonStep: pair.comparison,
		});
		// A step that failed didn't end where its counterpart did: it gave up.
		if (isErrorSpan(pair.primary) || isErrorSpan(pair.comparison)) continue;
		candidates.push({
			primaryMs: endMs(pair.primary),
			comparisonMs: endMs(pair.comparison),
			kind: "step-end",
			weight: 1,
			comparisonStep: pair.comparison,
		});
	}
	const finished = primary.passed && comparison.passed;
	if (finished) {
		candidates.push(
			{
				primaryMs: bodyEndMs(primary),
				comparisonMs: bodyEndMs(comparison),
				kind: "body-end",
				weight: REQUIRED,
			},
			{
				primaryMs: primary.durationMs,
				comparisonMs: comparison.durationMs,
				kind: "test-end",
				weight: REQUIRED,
			},
		);
	}

	const chain = monotoneChain(candidates);
	if (!finished) {
		const last = chain[chain.length - 1];
		const fromMs = last.comparisonStep
			? endMs(last.comparisonStep)
			: last.comparisonMs;
		const nextAction = actionsInRunOrder(comparison.steps).find(
			(step) => step.startOffsetMs >= fromMs && step !== last.comparisonStep,
		);
		chain.push({
			primaryMs: Math.max(last.primaryMs, bodyEndMs(primary) - 1),
			comparisonMs: Math.max(
				last.comparisonMs,
				(nextAction?.startOffsetMs ?? bodyEndMs(comparison)) - 1,
			),
			kind: "settled",
			weight: 0,
		});
	}

	const anchors = chain.map(({ primaryMs, comparisonMs, kind }) => ({
		primaryMs,
		comparisonMs,
		kind,
	}));
	const last = anchors[anchors.length - 1];
	return {
		anchors,
		hasStepAnchors: anchors.some(
			(anchor) => anchor.kind === "step-start" || anchor.kind === "step-end",
		),
		comparisonTimeAt(primaryMs) {
			if (primaryMs <= 0) return 0;
			if (primaryMs >= last.primaryMs) return last.comparisonMs;
			let index = 0;
			while (anchors[index + 1].primaryMs <= primaryMs) index++;
			const from = anchors[index];
			const to = anchors[index + 1];
			const progress =
				(primaryMs - from.primaryMs) / (to.primaryMs - from.primaryMs);
			return (
				from.comparisonMs + progress * (to.comparisonMs - from.comparisonMs)
			);
		},
	};
}

/** Anchors the two runs must share whatever the steps say. */
const REQUIRED = 1e6;

interface Candidate extends TimeAnchor {
	weight: number;
	comparisonStep?: Span;
}

const endMs = (step: Span) => step.startOffsetMs + step.durationMs;

function bodyStartMs(run: MappedRun): number {
	const { beforeHooks } = run.structure;
	return beforeHooks ? endMs(beforeHooks) : (run.steps[0]?.startOffsetMs ?? 0);
}

function bodyEndMs(run: MappedRun): number {
	return run.structure.afterHooks?.startOffsetMs ?? run.durationMs;
}

/** Steps without child steps that aren't expects, in the order they started. */
function actionsInRunOrder(steps: Span[]): Span[] {
	const parentIds = new Set(steps.map((step) => step.parentId));
	return steps
		.filter(
			(step) =>
				!parentIds.has(step.id) &&
				step.attributes["test.step.category"] !== "expect",
		)
		.sort((a, b) => a.startOffsetMs - b.startOffsetMs);
}

/**
 * Keeps the heaviest set of anchors in which neither clock runs backwards.
 * Steps that overlap (an expect left unawaited, a `Promise.all`) give anchors
 * that disagree; the ones out of line with the rest are dropped.
 */
function monotoneChain(candidates: Candidate[]): Candidate[] {
	const sorted = [...candidates].sort(
		(a, b) => a.primaryMs - b.primaryMs || a.comparisonMs - b.comparisonMs,
	);
	const best = sorted.map((anchor) => anchor.weight);
	const previous = sorted.map(() => -1);
	for (let i = 0; i < sorted.length; i++) {
		for (let j = 0; j < i; j++) {
			if (
				sorted[j].comparisonMs <= sorted[i].comparisonMs &&
				best[j] + sorted[i].weight > best[i]
			) {
				best[i] = best[j] + sorted[i].weight;
				previous[i] = j;
			}
		}
	}
	let at = best.indexOf(Math.max(...best));
	const chain: Candidate[] = [];
	for (; at !== -1; at = previous[at]) chain.unshift(sorted[at]);
	return chain;
}
