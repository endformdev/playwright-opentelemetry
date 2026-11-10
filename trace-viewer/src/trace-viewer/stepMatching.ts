import type { Span } from "../trace-data-loader/exportToSpans";
import { formatStepTitle } from "../trace-data-loader/stepTitle";
import type { TestStructure } from "./testStructure";

const STEP_SPAN_NAME = "playwright.test.step";

/** The steps of a test body that matching reads: no requests. */
export const matchableSteps = (structure: TestStructure): Span[] =>
	structure.bodySteps.filter((step) => step.name === STEP_SPAN_NAME);

/**
 * Why two steps were paired, strongest first:
 *  - "text": same kind of step and same text
 *  - "locator": same kind of step on the same locator, another value (a
 *    generated email, a new order number)
 *  - "changed": the same kind of step between the same matched neighbours, or
 *    a test.step block paired through the actions inside it
 *
 * Source lines are not evidence. Once the file is edited another step can sit
 * on a step's old line, and steps in a page-object helper all share one.
 */
export type MatchEvidence = "text" | "locator" | "changed";

export interface StepPair {
	primary: Span;
	comparison: Span;
	evidence: MatchEvidence;
	/** Paired although the two runs ran it in a different order */
	outOfOrder: boolean;
}

export interface StepMatch {
	pairs: StepPair[];
	byPrimaryId: ReadonlyMap<string, StepPair>;
	byComparisonId: ReadonlyMap<string, StepPair>;
}

/** Above this many score cells, actions are not aligned; blocks pair by title. */
const MAX_ALIGNMENT_CELLS = 4_000_000;

/**
 * Above this many score cells, steps left between the same two neighbours
 * pair by kind alone. Comparing their text token by token costs about a
 * second when a thousand steps share one gap.
 */
const MAX_SIMILARITY_CELLS = 10_000;

/**
 * Pairs the test body steps of two runs of a test. Both lists hold the
 * `playwright.test.step` spans of the body: no hooks, fixtures or requests.
 *
 * Actions and expects (steps without child steps) are paired first: they
 * survive a test.step being renamed, split, merged or removed. test.step
 * blocks then pair through the actions they share, and by title when they
 * share none.
 */
export function matchSteps(primary: Span[], comparison: Span[]): StepMatch {
	const a = describeSteps(primary);
	const b = describeSteps(comparison);
	const leavesA = a.filter((step) => step.children.length === 0);
	const leavesB = b.filter((step) => step.children.length === 0);
	const leafPairs =
		leavesA.length * leavesB.length <= MAX_ALIGNMENT_CELLS
			? alignLeaves(leavesA, leavesB)
			: [];
	const blockPairs = pairBlocks(a, b, leafPairs);

	const pairs = [...leafPairs, ...blockPairs].map((pair): StepPair => ({
		primary: pair.a.span,
		comparison: pair.b.span,
		evidence: evidenceOf(pair.a, pair.b),
		outOfOrder: pair.outOfOrder ?? false,
	}));
	return {
		pairs,
		byPrimaryId: new Map(pairs.map((pair) => [pair.primary.id, pair])),
		byComparisonId: new Map(pairs.map((pair) => [pair.comparison.id, pair])),
	};
}

/** A step with what matching reads from it, worked out once. */
interface Described {
	span: Span;
	category: string;
	/** What the step does without what it does it to: `Click`, `Fill`, `Expect "toBeVisible"` */
	verb: string;
	/** Title and subtitle, as the timeline shows it */
	text: string;
	/** What the step acted on, `getByLabel('Email')`, or null for none */
	locator: string | null;
	startMs: number;
	endMs: number;
	parent: Described | null;
	children: Described[];
}

interface Candidate {
	a: Described;
	b: Described;
	score: number;
	outOfOrder?: boolean;
}

function describeSteps(steps: Span[]): Described[] {
	const described = steps.map((span): Described => {
		const category = String(span.attributes["test.step.category"] ?? "");
		const value = span.attributes["test.step.param.value"];
		return {
			span,
			category,
			verb: verbOf(
				category,
				span.title,
				typeof value === "string" ? value : undefined,
			),
			text: formatStepTitle(span),
			locator: locatorOf(span),
			startMs: span.startOffsetMs,
			endMs: span.startOffsetMs + span.durationMs,
			parent: null,
			children: [],
		};
	});
	const byId = new Map(described.map((step) => [step.span.id, step]));
	for (const step of described) {
		const parent = step.span.parentId
			? byId.get(step.span.parentId)
			: undefined;
		if (!parent) continue;
		step.parent = parent;
		parent.children.push(step);
	}
	return described;
}

/**
 * Quoted parts of an action's title are values (`Fill "John Doe"`); an
 * expect's quoted part is its matcher. A test.step has no verb: its title is
 * free text. The reported value goes first and whole, so quotes inside it
 * don't leave a piece behind.
 */
function verbOf(category: string, title: string, value?: string): string {
	if (category === "test.step") return "";
	if (category === "expect") return title;
	const rest = value === undefined ? title : title.replace(`"${value}"`, "");
	return rest
		.replace(/\s*"[^"]*"/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * The locator the reporter recorded as a param (Playwright 1.63 and newer),
 * else the subtitle: older traces get one by splitting it off the title.
 */
function locatorOf(span: Span): string | null {
	const param = span.attributes["test.step.param.locator"];
	if (typeof param === "string" && param.length > 0) return param;
	return span.subtitle || null;
}

/**
 * Whether two steps are the same step, as a score, or 0 when they aren't:
 * the same verb on the same text, or on the same locator with another value.
 * Similar text alone is not evidence: `Fill ... { name: 'City' }` and
 * `Fill ... { name: 'State' }` are mostly the same characters. Every pair of
 * steps is scored, so this only compares strings.
 */
function sameStepScore(a: Described, b: Described): number {
	if (a.category !== b.category || a.verb !== b.verb) return 0;
	let score: number;
	if (a.text === b.text) score = 1;
	else if (sameLocator(a, b)) score = 0.8;
	else return 0;
	// The same action under the same step is likelier the same action.
	return score + (a.parent?.span.title === b.parent?.span.title ? 0.05 : 0);
}

const sameLocator = (a: Described, b: Described) =>
	a.locator !== null && a.locator === b.locator;

/** For steps left over between the same two matched neighbours. */
function changedStepScore(a: Described, b: Described): number {
	if (a.category !== b.category || a.verb !== b.verb) return 0;
	const similarity = textSimilarity(a.text, b.text);
	if (a.category === "test.step" && similarity < 0.5) return 0;
	return 0.3 + 0.5 * similarity;
}

/** For a gap too big to compare text in: actions of a kind pair in order. */
const sameKindScore = (a: Described, b: Described) =>
	a.category === b.category && a.verb === b.verb && a.category !== "test.step"
		? 0.3
		: 0;

function evidenceOf(a: Described, b: Described): MatchEvidence {
	if (a.text === b.text) return "text";
	return sameLocator(a, b) ? "locator" : "changed";
}

/**
 * Leaves in the order they ran. Times are whole milliseconds, so steps often
 * start together; the one that ends first goes first, which keeps a
 * zero-length expect ahead of the action after it.
 */
const inRunOrder = (steps: Described[]) =>
	[...steps].sort((x, y) => x.startMs - y.startMs || x.endMs - y.endMs);

/**
 * Three passes, each only over what the last left unpaired:
 *  1. order-preserving, strong evidence only
 *  2. strong pairs that sit one position out of order (steps running at once)
 *  3. between the same two matched neighbours, steps of the same kind in
 *     order: an edited locator. In a gap too big to compare text in, by kind
 *     alone
 */
function alignLeaves(leavesA: Described[], leavesB: Described[]): Candidate[] {
	const a = inRunOrder(leavesA);
	const b = inRunOrder(leavesB);
	const indexA = new Map(a.map((step, index) => [step, index]));
	const pairs = alignSequences(a, b, sameStepScore);

	// The gap an unpaired step sits in: how many ordered pairs come before it.
	const gaps = (steps: Described[], side: "a" | "b", among: Candidate[]) => {
		const anchors = new Set(among.map((pair) => pair[side]));
		const paired = new Set(pairs.map((pair) => pair[side]));
		const result = new Map<Described, number>();
		let count = 0;
		for (const step of steps) {
			if (anchors.has(step)) count++;
			else if (!paired.has(step)) result.set(step, count);
		}
		return result;
	};

	const ordered = [...pairs];
	const looseA = gaps(a, "a", ordered);
	const looseB = gaps(b, "b", ordered);
	for (const [stepA, gapA] of looseA) {
		let best: Candidate | null = null;
		for (const [stepB, gapB] of looseB) {
			const score =
				Math.abs(gapA - gapB) <= 1 ? sameStepScore(stepA, stepB) : 0;
			if (score > (best?.score ?? 0)) {
				best = { a: stepA, b: stepB, score, outOfOrder: true };
			}
		}
		if (best) {
			pairs.push(best);
			looseB.delete(best.b);
		}
	}

	const restA = gaps(a, "a", ordered);
	const restB = gaps(b, "b", ordered);
	for (const gap of new Set(restA.values())) {
		const inA = [...restA].filter(([, g]) => g === gap).map(([step]) => step);
		const inB = [...restB].filter(([, g]) => g === gap).map(([step]) => step);
		const compareText = inA.length * inB.length <= MAX_SIMILARITY_CELLS;
		pairs.push(
			...alignSequences(
				inA,
				inB,
				compareText ? changedStepScore : sameKindScore,
			),
		);
	}
	return pairs.sort((x, y) => indexA.get(x.a)! - indexA.get(y.a)!);
}

const leavesUnder = (step: Described): Described[] =>
	step.children.length === 0 ? [step] : step.children.flatMap(leavesUnder);

/**
 * Blocks pair with the block holding most of their paired actions, at any
 * depth. Those sharing no action pair by title, in order.
 */
function pairBlocks(
	a: Described[],
	b: Described[],
	leafPairs: Candidate[],
): Candidate[] {
	const partner = new Map(leafPairs.map((pair) => [pair.a, pair.b]));
	const blocksA = a.filter((step) => step.children.length > 0);
	const blocksB = b.filter((step) => step.children.length > 0);

	const candidates: Array<Candidate & { shared: number }> = [];
	for (const blockA of blocksA) {
		const leaves = leavesUnder(blockA);
		const shared = new Map<Described, number>();
		for (const leaf of leaves) {
			for (let block = partner.get(leaf)?.parent; block; block = block.parent) {
				shared.set(block, (shared.get(block) ?? 0) + 1);
			}
		}
		for (const [blockB, count] of shared) {
			const size = Math.max(leaves.length, leavesUnder(blockB).length);
			candidates.push({
				a: blockA,
				b: blockB,
				shared: count,
				score: count / size,
			});
		}
	}
	candidates.sort((x, y) => y.score - x.score || y.shared - x.shared);

	const pairs: Candidate[] = [];
	const usedA = new Set<Described>();
	const usedB = new Set<Described>();
	for (const candidate of candidates) {
		if (usedA.has(candidate.a) || usedB.has(candidate.b)) continue;
		usedA.add(candidate.a);
		usedB.add(candidate.b);
		pairs.push(candidate);
	}
	pairs.push(
		...alignSequences(
			blocksA.filter((block) => !usedA.has(block)),
			blocksB.filter((block) => !usedB.has(block)),
			(x, y) => (x.span.title === y.span.title ? 1 : 0),
		),
	);
	return pairs;
}

/** Order-preserving pairing of two lists that maximises the summed score. */
function alignSequences(
	a: Described[],
	b: Described[],
	score: (a: Described, b: Described) => number,
): Candidate[] {
	const scores = a.map((stepA) => b.map((stepB) => score(stepA, stepB)));
	const best = Array.from(
		{ length: a.length + 1 },
		() => new Float64Array(b.length + 1),
	);
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const s = scores[i - 1][j - 1];
			const paired = s > 0 ? best[i - 1][j - 1] + s : -1;
			best[i][j] = Math.max(paired, best[i - 1][j], best[i][j - 1]);
		}
	}
	// Walking back from the end, skip a step whenever that loses nothing, so
	// that among equal pairings the earliest steps pair: the first rounds of a
	// loop that ran more often in one run.
	const pairs: Candidate[] = [];
	let i = a.length;
	let j = b.length;
	while (i > 0 && j > 0) {
		const s = scores[i - 1][j - 1];
		if (best[i][j] === best[i - 1][j]) i--;
		else if (best[i][j] === best[i][j - 1]) j--;
		else {
			pairs.push({ a: a[i - 1], b: b[j - 1], score: s });
			i--;
			j--;
		}
	}
	return pairs.reverse();
}

/** Word and separator tokens, so a generated value only differs in itself. */
const tokenize = (text: string) =>
	text.match(/[A-Za-z0-9_$-]+|\s+|[^\sA-Za-z0-9_$-]/g) ?? [];

/** 0 to 1: how much of two step texts is the same, token by token. */
function textSimilarity(a: string, b: string): number {
	if (a === b) return 1;
	const tokensA = tokenize(a);
	const tokensB = tokenize(b);
	if (tokensA.length + tokensB.length === 0) return 1;
	let previous: number[] = Array.from({ length: tokensB.length + 1 }, () => 0);
	for (let i = 1; i <= tokensA.length; i++) {
		const row = [0];
		for (let j = 1; j <= tokensB.length; j++) {
			row[j] =
				tokensA[i - 1] === tokensB[j - 1]
					? previous[j - 1] + 1
					: Math.max(previous[j], row[j - 1]);
		}
		previous = row;
	}
	return (2 * previous[tokensB.length]) / (tokensA.length + tokensB.length);
}
