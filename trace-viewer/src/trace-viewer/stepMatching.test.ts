import { describe, expect, it } from "vitest";
import type { Span } from "../trace-data-loader/exportToSpans";
import { matchSteps, type StepMatch } from "./stepMatching";
import { type StepRow, stepsFromRows } from "./testStepRows";

const pairsOf = (match: StepMatch) =>
	match.pairs
		.map((pair) => [pair.primary.id, pair.comparison.id, pair.evidence])
		.sort(([x], [y]) => String(x).localeCompare(String(y)));

const match = (primary: StepRow[], comparison: StepRow[]) =>
	matchSteps(stepsFromRows("a", primary), stepsFromRows("b", comparison));

/** Adds the `test.step.param.*` attributes Playwright 1.63 reports to a step. */
const withParams = (
	steps: Span[],
	id: string,
	params: Record<string, string>,
): Span[] =>
	steps.map((step) =>
		step.id === id
			? {
					...step,
					attributes: {
						...step.attributes,
						...Object.fromEntries(
							Object.entries(params).map(([key, value]) => [
								`test.step.param.${key}`,
								value,
							]),
						),
					},
				}
			: step,
	);

const logIn = (offset = 0): StepRow[] => [
	[
		"test.step",
		"Log in",
		null,
		5 + offset,
		100,
		400,
		[
			[
				"pw:api",
				'Fill "jane@example.com"',
				"getByLabel('Email')",
				6 + offset,
				100,
				200,
			],
			[
				"pw:api",
				"Click",
				"getByRole('button', { name: 'Log in' })",
				7 + offset,
				200,
				300,
			],
		],
	],
	[
		"expect",
		'Expect "toBeVisible"',
		"getByText('Welcome')",
		8 + offset,
		400,
		450,
	],
];

describe("matchSteps", () => {
	it("pairs every step of two identical runs by text", () => {
		expect(pairsOf(match(logIn(), logIn()))).toEqual([
			["a:0", "b:0", "text"],
			["a:0.0", "b:0.0", "text"],
			["a:0.1", "b:0.1", "text"],
			["a:1", "b:1", "text"],
		]);
	});

	it("pairs a generated value by its locator, and a generated locator as changed", () => {
		const result = match(
			[
				[
					"pw:api",
					'Fill "user-123@example.com"',
					"getByLabel('Email')",
					6,
					0,
					10,
				],
				["pw:api", "Click", "getByText('Order 123')", 7, 10, 20],
			],
			[
				[
					"pw:api",
					'Fill "user-456@example.com"',
					"getByLabel('Email')",
					6,
					0,
					10,
				],
				["pw:api", "Click", "getByText('Order 456')", 7, 10, 20],
			],
		);
		expect(pairsOf(result)).toEqual([
			["a:0", "b:0", "locator"],
			["a:1", "b:1", "changed"],
		]);
	});

	it("pairs by text when every line moved", () => {
		expect(pairsOf(match(logIn(), logIn(3)))).toEqual([
			["a:0", "b:0", "text"],
			["a:0.0", "b:0.0", "text"],
			["a:0.1", "b:0.1", "text"],
			["a:1", "b:1", "text"],
		]);
	});

	it("pairs an edited step between matched neighbours as changed", () => {
		const result = match(
			[
				["pw:api", 'Fill "Jane"', "getByLabel('Name')", 10, 0, 10],
				[
					"pw:api",
					"Click",
					"getByRole('button', { name: 'Save' })",
					11,
					10,
					20,
				],
				["expect", 'Expect "toBeVisible"', "getByText('Saved')", 12, 20, 30],
			],
			[
				["pw:api", 'Fill "Jane"', "getByLabel('Name')", 13, 0, 10],
				[
					"pw:api",
					"Click",
					"getByRole('button', { name: 'Submit' })",
					14,
					10,
					20,
				],
				["expect", 'Expect "toBeVisible"', "getByText('Saved')", 15, 20, 30],
			],
		);
		expect(pairsOf(result)).toEqual([
			["a:0", "b:0", "text"],
			["a:1", "b:1", "changed"],
			["a:2", "b:2", "text"],
		]);
	});

	it("pairs the larger of two swapped blocks, leaving the other's actions alone", () => {
		const address = (line: number, startMs: number): StepRow => [
			"test.step",
			"Fill in the address",
			null,
			line,
			startMs,
			startMs + 30,
			[
				[
					"pw:api",
					'Fill "Main St"',
					"getByLabel('Street')",
					line + 1,
					startMs,
					startMs + 10,
				],
				[
					"pw:api",
					'Fill "Springfield"',
					"getByLabel('City')",
					line + 2,
					startMs + 10,
					startMs + 20,
				],
				[
					"pw:api",
					'Fill "IL"',
					"getByLabel('State')",
					line + 3,
					startMs + 20,
					startMs + 30,
				],
			],
		];
		const name = (line: number, startMs: number): StepRow => [
			"test.step",
			"Fill in the name",
			null,
			line,
			startMs,
			startMs + 10,
			[
				[
					"pw:api",
					'Fill "Jane"',
					"getByLabel('Name')",
					line + 1,
					startMs,
					startMs + 10,
				],
			],
		];
		const result = match(
			[address(10, 0), name(20, 100)],
			[name(10, 0), address(13, 100)],
		);
		const actions = pairsOf(result).filter(([id]) => String(id).includes("."));
		expect(actions).toEqual([
			["a:0.0", "b:1.0", "text"],
			["a:0.1", "b:1.1", "text"],
			["a:0.2", "b:1.2", "text"],
		]);
		expect(result.byPrimaryId.get("a:0")?.comparison.id).toBe("b:1");
	});

	it("pairs retitled blocks through their actions", () => {
		const retitled = logIn().map((row): StepRow =>
			row[0] === "test.step"
				? ([row[0], "Sign in", ...row.slice(2)] as StepRow)
				: row,
		);
		const result = match(logIn(), retitled);
		expect(result.byPrimaryId.get("a:0")?.comparison.id).toBe("b:0");
	});

	it("pairs every action when one run has no test.step blocks", () => {
		const unwrapped = logIn().flatMap((row) => row[6] ?? [row]);
		const result = match(logIn(), unwrapped);
		expect(pairsOf(result)).toEqual([
			["a:0.0", "b:0", "text"],
			["a:0.1", "b:1", "text"],
			["a:1", "b:2", "text"],
		]);
	});

	it("pairs the inner blocks when one run wraps them in another block", () => {
		const wrapped: StepRow[] = [
			["test.step", "Check out", null, 4, 100, 450, logIn()],
		];
		const result = match(logIn(), wrapped);
		expect(pairsOf(result)).toEqual([
			["a:0", "b:0.0", "text"],
			["a:0.0", "b:0.0.0", "text"],
			["a:0.1", "b:0.0.1", "text"],
			["a:1", "b:0.1", "text"],
		]);
		expect(result.byComparisonId.has("b:0")).toBe(false);
	});

	it("leaves the actions of a step only the primary has unpaired", () => {
		const added: StepRow[] = [
			[
				"test.step",
				"Add a coupon",
				null,
				20,
				500,
				600,
				[["pw:api", 'Fill "SAVE10"', "getByLabel('Coupon')", 21, 500, 600]],
			],
		];
		const result = match([...logIn(), ...added], logIn());
		expect(result.pairs).toHaveLength(4);
		expect(result.byPrimaryId.has("a:2")).toBe(false);
		expect(result.byPrimaryId.has("a:2.0")).toBe(false);
	});

	it("leaves the steps only the comparison has out of the pairs", () => {
		const removed: StepRow[] = [
			[
				"test.step",
				"Add a coupon",
				null,
				20,
				500,
				600,
				[["pw:api", 'Fill "SAVE10"', "getByLabel('Coupon')", 21, 500, 600]],
			],
		];
		const result = match(logIn(), [...logIn(), ...removed]);
		expect(result.pairs).toHaveLength(4);
		expect(result.byComparisonId.has("b:2")).toBe(false);
		expect(result.byComparisonId.has("b:2.0")).toBe(false);
	});

	it("pairs the first rounds of a loop that ran more often, then the step after it", () => {
		const loop = (rounds: number): StepRow[] => [
			...Array.from({ length: rounds }, (_, round): StepRow => [
				"test.step",
				"Add an item",
				null,
				10,
				round * 100,
				round * 100 + 50,
				[
					[
						"pw:api",
						"Click",
						"getByRole('button', { name: 'Add' })",
						11,
						round * 100,
						round * 100 + 40,
					],
					[
						"expect",
						'Expect "toHaveCount"',
						"getByRole('listitem')",
						12,
						round * 100 + 40,
						round * 100 + 50,
					],
				],
			]),
			[
				"pw:api",
				"Click",
				"getByRole('link', { name: 'Check out' })",
				14,
				rounds * 100,
				rounds * 100 + 50,
			],
		];
		const result = match(loop(4), loop(2));
		expect(pairsOf(result)).toEqual([
			["a:0", "b:0", "text"],
			["a:0.0", "b:0.0", "text"],
			["a:0.1", "b:0.1", "text"],
			["a:1", "b:1", "text"],
			["a:1.0", "b:1.0", "text"],
			["a:1.1", "b:1.1", "text"],
			["a:4", "b:2", "text"],
		]);
	});

	it("pairs steps that start in the same millisecond, in either order", () => {
		const click: StepRow = [
			"pw:api",
			"Click",
			"getByText('Next')",
			10,
			100,
			150,
		];
		const check: StepRow = [
			"expect",
			'Expect "toBeVisible"',
			"getByText('Done')",
			11,
			100,
			100,
		];
		const result = match([click, check], [check, click]);
		expect(pairsOf(result)).toEqual([
			["a:0", "b:1", "text"],
			["a:1", "b:0", "text"],
		]);
		expect(result.pairs.every((pair) => !pair.outOfOrder)).toBe(true);
	});

	it("marks a pair of steps that ran the other way round as out of order", () => {
		const result = match(
			[
				["pw:api", "Click", "getByText('One')", 10, 100, 110],
				["pw:api", "Click", "getByText('Two')", 11, 110, 120],
			],
			[
				["pw:api", "Click", "getByText('Two')", 11, 100, 110],
				["pw:api", "Click", "getByText('One')", 10, 110, 120],
			],
		);
		expect(pairsOf(result)).toEqual([
			["a:0", "b:1", "text"],
			["a:1", "b:0", "text"],
		]);
		expect(result.pairs.filter((pair) => pair.outOfOrder)).toHaveLength(1);
	});

	it("doesn't pair steps on the same locator that do something else", () => {
		const result = match(
			[["pw:api", "Click", "getByLabel('Name')", 10, 0, 10]],
			[["pw:api", 'Fill "Jane"', "getByLabel('Name')", 10, 0, 10]],
		);
		expect(result.pairs).toEqual([]);
	});

	it("pairs blocks that share no action by title", () => {
		const result = match(
			[
				[
					"test.step",
					"Set up",
					null,
					5,
					0,
					10,
					[
						[
							"pw:api",
							"Click",
							"getByRole('button', { name: 'Start' })",
							6,
							0,
							10,
						],
					],
				],
			],
			[
				[
					"test.step",
					"Set up",
					null,
					9,
					0,
					10,
					[["pw:api", 'Fill "Jane"', "getByLabel('Name')", 10, 0, 10]],
				],
			],
		);
		expect(pairsOf(result)).toEqual([["a:0", "b:0", "text"]]);
	});

	it("pairs an action repeated under two blocks under the block with the same title", () => {
		const logInAs = (role: string, startMs: number): StepRow => [
			"test.step",
			`Log in as ${role}`,
			null,
			role === "admin" ? 5 : 8,
			startMs,
			startMs + 10,
			[
				[
					"pw:api",
					"Click",
					"getByRole('button', { name: 'Log in' })",
					50,
					startMs,
					startMs + 10,
				],
			],
		];
		const result = match(
			[logInAs("admin", 0), logInAs("user", 100)],
			[logInAs("user", 0)],
		);
		expect(pairsOf(result)).toEqual([
			["a:1", "b:0", "text"],
			["a:1.0", "b:0.0", "text"],
		]);
	});

	it("pairs a fill whose only shared text is its locator", () => {
		const result = match(
			[
				[
					"pw:api",
					'Fill "4111 1111 1111 1111"',
					"getByLabel('Card')",
					10,
					0,
					10,
				],
			],
			[
				[
					"pw:api",
					'Fill "5500 0000 0000 0004"',
					"getByLabel('Card')",
					14,
					0,
					10,
				],
			],
		);
		expect(pairsOf(result)).toEqual([["a:0", "b:0", "locator"]]);
	});

	it("pairs by locator when a line shift puts another step on the old line", () => {
		// A line added above both fills: the password fill now sits on the
		// email fill's old line, and both values are generated.
		const result = match(
			[
				[
					"pw:api",
					'Fill "user-1@example.com"',
					"getByLabel('Email')",
					10,
					0,
					10,
				],
				["pw:api", 'Fill "pw-1"', "getByLabel('Password')", 11, 10, 20],
			],
			[
				[
					"pw:api",
					'Fill "user-2@example.com"',
					"getByLabel('Email')",
					11,
					0,
					10,
				],
				["pw:api", 'Fill "pw-2"', "getByLabel('Password')", 12, 10, 20],
			],
		);
		expect(pairsOf(result)).toEqual([
			["a:0", "b:0", "locator"],
			["a:1", "b:1", "locator"],
		]);
	});

	it("doesn't pair page-object fills on other fields for sharing the helper's line", () => {
		// Every fill comes from one `fillField` helper. The comparison no
		// longer fills the email but fills a phone number after the name.
		const fill = (value: string, label: string, startMs: number): StepRow => [
			"pw:api",
			`Fill "${value}"`,
			`getByLabel('${label}')`,
			32,
			startMs,
			startMs + 10,
		];
		const result = match(
			[fill("user-1@example.com", "Email", 0), fill("Jane", "Name", 10)],
			[fill("Jane", "Name", 0), fill("555 0100", "Phone", 10)],
		);
		expect(pairsOf(result)).toEqual([["a:1", "b:0", "text"]]);
	});

	it("pairs a generated fill value after an edit puts a new fill on its line", () => {
		const result = match(
			[
				[
					"pw:api",
					"Click",
					"getByRole('link', { name: 'Sign up' })",
					10,
					0,
					10,
				],
				[
					"pw:api",
					'Fill "user-1@example.com"',
					"getByLabel('Email')",
					12,
					10,
					20,
				],
				[
					"pw:api",
					"Click",
					"getByRole('button', { name: 'Save' })",
					13,
					20,
					30,
				],
			],
			[
				[
					"pw:api",
					"Click",
					"getByRole('link', { name: 'Sign up' })",
					10,
					0,
					10,
				],
				["pw:api", 'Fill "Acme"', "getByLabel('Company')", 12, 10, 20],
				[
					"pw:api",
					'Fill "user-2@example.com"',
					"getByLabel('Email')",
					13,
					20,
					30,
				],
				[
					"pw:api",
					"Click",
					"getByRole('button', { name: 'Save' })",
					14,
					30,
					40,
				],
			],
		);
		expect(pairsOf(result)).toEqual([
			["a:0", "b:0", "text"],
			["a:1", "b:2", "locator"],
			["a:2", "b:3", "text"],
		]);
	});

	it("reads the locator and value from the step's params when it has them", () => {
		// The value has quotes in it, and the subtitles differ in a way the
		// recorded locators don't.
		const primary = withParams(
			stepsFromRows("a", [
				["pw:api", 'Fill "say "hi""', "getByLabel('Note') (1)", 10, 0, 10],
			]),
			"a:0",
			{ locator: "getByLabel('Note')", value: 'say "hi"' },
		);
		const comparison = withParams(
			stepsFromRows("b", [
				["pw:api", 'Fill "bye"', "getByLabel('Note') (2)", 10, 0, 10],
			]),
			"b:0",
			{ locator: "getByLabel('Note')", value: "bye" },
		);
		expect(pairsOf(matchSteps(primary, comparison))).toEqual([
			["a:0", "b:0", "locator"],
		]);
	});

	it("matches a long test without holding up the page", () => {
		// Same verbs throughout and values that differ between the runs: every
		// step is scored against every other.
		const longRun = (run: number) =>
			Array.from({ length: 1000 }, (_, index): StepRow => [
				"pw:api",
				`Fill "value ${index}-${run}"`,
				`getByRole('textbox', { name: 'Field ${index % 25}' })`,
				100 + (index % 40),
				index * 10,
				index * 10 + 5,
			]);
		const start = performance.now();
		const result = match(longRun(1), longRun(2));
		const elapsedMs = performance.now() - start;

		expect(result.pairs).toHaveLength(1000);
		expect(result.pairs.every((pair) => pair.evidence === "locator")).toBe(
			true,
		);
		// About 50ms; scoring every pair by its text took a second.
		expect(elapsedMs).toBeLessThan(500);
	});

	it("matches a long test that shares no text or locator without holding up the page", () => {
		// Every locator holds a generated value, so all steps are left to pair
		// as changed, in one gap.
		const longRun = (run: number) =>
			Array.from({ length: 1000 }, (_, index): StepRow => [
				"pw:api",
				"Click",
				`getByText('Order ${run}-${index}')`,
				null,
				index * 10,
				index * 10 + 5,
			]);
		const start = performance.now();
		const result = match(longRun(1), longRun(2));
		const elapsedMs = performance.now() - start;

		expect(result.pairs).toHaveLength(1000);
		expect(result.pairs.every((pair) => pair.evidence === "changed")).toBe(
			true,
		);
		// About 60ms; comparing the texts of a thousand steps took a second.
		expect(elapsedMs).toBeLessThan(500);
	});

	it("pairs nothing when either side has no steps", () => {
		expect(match([], logIn()).pairs).toEqual([]);
		expect(match(logIn(), []).pairs).toEqual([]);
		expect(match([], []).pairs).toEqual([]);
	});
});
