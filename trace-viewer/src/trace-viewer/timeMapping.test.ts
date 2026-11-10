import { describe, expect, it } from "vitest";
import type { Span } from "../trace-data-loader/exportToSpans";
import { matchableSteps, matchSteps, type StepMatch } from "./stepMatching";
import { buildTestStructure } from "./testStructure";
import { type StepRow, stepsFromRows } from "./testStepRows";
import { buildTimeMapping, type MappedRun } from "./timeMapping";

interface RunOptions {
	/** When the Before Hooks end and the test body starts */
	bodyStartMs?: number;
	/** When the After Hooks start and the test body ends */
	bodyEndMs: number;
	durationMs: number;
	passed?: boolean;
	/** Ids of steps that failed, as `stepsFromRows` names them */
	failedIds?: string[];
}

/** A whole run: the test span, its hooks and the body steps from rows. */
function run(prefix: string, rows: StepRow[], options: RunOptions): MappedRun {
	const { bodyStartMs = 50, bodyEndMs, durationMs, passed = true } = options;
	const rootId = `${prefix}:root`;
	const span = (id: string, title: string, startMs: number, endMs: number) =>
		({
			id,
			parentId: rootId,
			traceId: `trace-${prefix}`,
			name: "playwright.test.step",
			title,
			startOffsetMs: startMs,
			durationMs: endMs - startMs,
			kind: "internal",
			attributes: { "test.step.category": "hook" },
			serviceName: "playwright",
		}) satisfies Span;
	const failed = new Set(options.failedIds);
	const body = stepsFromRows(prefix, rows).map((step) => ({
		...step,
		parentId: step.parentId ?? rootId,
		...(failed.has(step.id) && { status: { code: 2 } }),
	}));
	const structure = buildTestStructure([
		{
			...span(rootId, "My test", 0, durationMs),
			parentId: null,
			name: "playwright.test",
		},
		span(`${prefix}:before`, "Before Hooks", 0, bodyStartMs),
		...body,
		span(`${prefix}:after`, "After Hooks", bodyEndMs, durationMs),
	]);
	return { structure, steps: matchableSteps(structure), durationMs, passed };
}

const mapping = (primary: MappedRun, comparison: MappedRun) =>
	buildTimeMapping(
		primary,
		comparison,
		matchSteps(primary.steps, comparison.steps),
	);

const click = (
	name: string,
	line: number,
	startMs: number,
	endMs: number,
): StepRow => ["pw:api", "Click", `getByText('${name}')`, line, startMs, endMs];
const check = (
	name: string,
	line: number,
	startMs: number,
	endMs: number,
): StepRow => [
	"expect",
	'Expect "toBeVisible"',
	`getByText('${name}')`,
	line,
	startMs,
	endMs,
];

describe("buildTimeMapping", () => {
	it("stretches the test body to fit when no step matched", () => {
		const result = mapping(
			run("a", [click("One", 10, 100, 200)], {
				bodyEndMs: 1000,
				durationMs: 1100,
			}),
			run("b", [check("One", 20, 100, 200)], {
				bodyStartMs: 100,
				bodyEndMs: 2100,
				durationMs: 2200,
			}),
		);
		expect(result.anchors).toEqual([
			{ primaryMs: 0, comparisonMs: 0, kind: "test-start" },
			{ primaryMs: 50, comparisonMs: 100, kind: "body-start" },
			{ primaryMs: 1000, comparisonMs: 2100, kind: "body-end" },
			{ primaryMs: 1100, comparisonMs: 2200, kind: "test-end" },
		]);
		expect(result.hasStepAnchors).toBe(false);
		expect(result.comparisonTimeAt(525)).toBe(1100);
	});

	it("lines up the starts and ends of paired steps of different lengths", () => {
		const result = mapping(
			run("a", [click("One", 10, 100, 200), click("Two", 11, 200, 800)], {
				bodyEndMs: 1000,
				durationMs: 1100,
			}),
			run("b", [click("One", 10, 100, 300), click("Two", 11, 300, 500)], {
				bodyEndMs: 600,
				durationMs: 700,
			}),
		);
		expect(result.hasStepAnchors).toBe(true);
		expect(result.comparisonTimeAt(100)).toBe(100);
		expect(result.comparisonTimeAt(150)).toBe(200);
		expect(result.comparisonTimeAt(200)).toBe(300);
		expect(result.comparisonTimeAt(500)).toBe(400);
		expect(result.comparisonTimeAt(800)).toBe(500);
	});

	it("holds the comparison between its neighbours over a step only the primary has", () => {
		const result = mapping(
			run(
				"a",
				[
					click("One", 10, 100, 200),
					click("Extra", 11, 200, 400),
					click("Two", 12, 400, 500),
				],
				{ bodyEndMs: 600, durationMs: 700 },
			),
			run("b", [click("One", 10, 100, 200), click("Two", 12, 200, 300)], {
				bodyEndMs: 400,
				durationMs: 500,
			}),
		);
		expect(result.comparisonTimeAt(300)).toBe(200);
		expect(result.comparisonTimeAt(450)).toBe(250);
	});

	it("passes over a step only the comparison has", () => {
		const result = mapping(
			run("a", [click("One", 10, 100, 200), click("Two", 12, 200, 300)], {
				bodyEndMs: 400,
				durationMs: 500,
			}),
			run(
				"b",
				[
					click("One", 10, 100, 200),
					click("Extra", 11, 200, 400),
					click("Two", 12, 400, 500),
				],
				{ bodyEndMs: 600, durationMs: 700 },
			),
		);
		expect(result.comparisonTimeAt(199)).toBe(199);
		expect(result.comparisonTimeAt(200)).toBe(400);
		expect(result.comparisonTimeAt(250)).toBe(450);
	});

	it("never runs backwards when steps overlap", () => {
		const primary = run(
			"a",
			[
				check("Banner", 10, 100, 500),
				click("One", 11, 150, 200),
				click("Two", 12, 200, 300),
			],
			{ bodyEndMs: 600, durationMs: 700 },
		);
		const result = mapping(
			primary,
			run(
				"b",
				[
					check("Banner", 10, 100, 200),
					click("One", 11, 150, 400),
					click("Two", 12, 400, 500),
				],
				{ bodyEndMs: 600, durationMs: 700 },
			),
		);
		let previous = -Infinity;
		for (let timeMs = 0; timeMs <= primary.durationMs; timeMs++) {
			const mapped = result.comparisonTimeAt(timeMs);
			expect(mapped).toBeGreaterThanOrEqual(previous);
			previous = mapped;
		}
	});

	describe("when the primary failed", () => {
		const checkOut = (third: StepRow, after: StepRow[] = []): StepRow[] => [
			[
				"test.step",
				"Check out",
				null,
				5,
				100,
				third[5],
				[click("Cart", 6, 100, 200), click("Pay", 7, 200, 300), third],
			],
			...after,
		];
		const primary = run("a", checkOut(check("Paid", 8, 300, 5300)), {
			bodyEndMs: 5400,
			durationMs: 5500,
			passed: false,
			failedIds: ["a:0", "a:0.2"],
		});

		it("settles just before the comparison's next action", () => {
			const comparison = run(
				"b",
				checkOut(check("Paid", 8, 300, 350), [
					check("Receipt", 9, 350, 360),
					click("Done", 10, 400, 450),
				]),
				{ bodyEndMs: 500, durationMs: 600 },
			);
			const result = mapping(primary, comparison);
			expect(result.comparisonTimeAt(5399)).toBe(399);
			expect(result.comparisonTimeAt(5400)).toBe(399);
			expect(result.comparisonTimeAt(primary.durationMs)).toBe(399);
		});

		it("settles just before the comparison's body ends when only expects follow", () => {
			const comparison = run(
				"b",
				checkOut(check("Paid", 8, 300, 350), [check("Receipt", 9, 360, 370)]),
				{ bodyEndMs: 500, durationMs: 600 },
			);
			const result = mapping(primary, comparison);
			expect(result.comparisonTimeAt(5399)).toBe(499);
			expect(result.comparisonTimeAt(primary.durationMs)).toBe(499);
		});

		it("anchors neither the failed step's end nor its block's", () => {
			const comparison = run(
				"b",
				checkOut(check("Paid", 8, 300, 350), [click("Done", 10, 400, 450)]),
				{ bodyEndMs: 500, durationMs: 600 },
			);
			const result = mapping(primary, comparison);
			const ends = result.anchors
				.filter((anchor) => anchor.kind === "step-end")
				.map((anchor) => anchor.primaryMs);
			expect(ends).toEqual([200, 300]);
			expect(result.anchors.at(-1)).toEqual({
				primaryMs: 5399,
				comparisonMs: 399,
				kind: "settled",
			});
		});
	});

	it("plays out a failed comparison as the primary's body ends, then holds", () => {
		const primary = run(
			"a",
			[
				click("One", 10, 100, 200),
				check("Two", 11, 300, 350),
				click("Three", 12, 400, 450),
			],
			{ bodyEndMs: 600, durationMs: 700 },
		);
		const comparison = run(
			"b",
			[click("One", 10, 100, 200), check("Two", 11, 300, 5300)],
			{ bodyEndMs: 5400, durationMs: 5500, passed: false, failedIds: ["b:1"] },
		);
		const result = mapping(primary, comparison);
		expect(result.comparisonTimeAt(599)).toBe(5399);
		expect(result.comparisonTimeAt(primary.durationMs)).toBe(5399);
	});

	it("takes no anchors from pairs marked out of order", () => {
		const primary = run("a", [click("One", 10, 100, 200)], {
			bodyEndMs: 300,
			durationMs: 400,
		});
		const comparison = run("b", [click("One", 10, 150, 250)], {
			bodyEndMs: 300,
			durationMs: 400,
		});
		const [pair] = matchSteps(primary.steps, comparison.steps).pairs;
		const outOfOrder = { ...pair, outOfOrder: true };
		const match: StepMatch = {
			pairs: [outOfOrder],
			byPrimaryId: new Map([[pair.primary.id, outOfOrder]]),
			byComparisonId: new Map([[pair.comparison.id, outOfOrder]]),
		};
		const result = buildTimeMapping(primary, comparison, match);
		expect(result.anchors.map((anchor) => anchor.kind)).toEqual([
			"test-start",
			"body-start",
			"body-end",
			"test-end",
		]);
	});

	it("clamps times before the start and after the end", () => {
		const result = mapping(
			run("a", [click("One", 10, 100, 200)], {
				bodyEndMs: 300,
				durationMs: 400,
			}),
			run("b", [click("One", 10, 100, 300)], {
				bodyEndMs: 500,
				durationMs: 800,
			}),
		);
		expect(result.comparisonTimeAt(-10)).toBe(0);
		expect(result.comparisonTimeAt(10_000)).toBe(800);
	});
});
