import path from "node:path";
import { openAsBlob } from "node:fs";
import type {
	FullResult,
	Reporter,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";
import {
	type ActionBox,
	type ActionPoint,
	type ActionsFile,
	type RecordedAction,
	readScreenshotsZip,
} from "../src/shared/screenshots-zip";

const SPEC_FILE = "action-highlights.spec.ts";
/** Boxes are rounded to hundredths, and layout to fractions of a pixel */
const TOLERANCE_PX = 1;

/** What a test of action-highlights.spec.ts expects of one recorded action. */
export interface ExpectedAction {
	method: string;
	/** `page-0` when left out */
	pageId?: string;
	failed?: true;
	/** One when left out */
	inputs?: number | "several";
	/** Of the last input: the box, or null for none. Unchecked when left out. */
	box?: ActionBox | null;
	/** Of the first input */
	firstBox?: ActionBox;
	/** Of the last input: the point, or null for none. Unchecked when left out. */
	point?: ActionPoint | null;
	/**
	 * `held`: the element was seen in place when the call ended or later.
	 * `lost`: only before. `until-next-action`: at the call's end, and no later
	 * than the next action's input. `none`: nothing was measured.
	 */
	steady?: "held" | "lost" | "until-next-action" | "none";
	/**
	 * Whether the action moved its element, by scrolling to it. Moved: it's
	 * only taken to be in its place from the input, or from the call's end for
	 * input without a point. Not moved: it was measured there beforehand.
	 * Unchecked when left out.
	 */
	moved?: boolean;
}

interface Check {
	test: TestCase;
	expected: ExpectedAction[];
	forbidden: string[];
}

/**
 * Fails the run if the trace ZIP of a test in action-highlights.spec.ts
 * doesn't hold the actions the test said it would. The ZIP is written by the
 * reporter under test once the test is over, so the test can't look itself.
 */
export default class ActionHighlightsReporter implements Reporter {
	private checks: Check[] = [];
	private problems: string[] = [];

	onTestEnd(test: TestCase, result: TestResult): void {
		if (!test.location.file.endsWith(SPEC_FILE)) {
			return;
		}
		const attachment = (name: string) =>
			result.attachments
				.filter((attachment) => attachment.name === name)
				.map((attachment) => attachment.body?.toString("utf8") ?? "");
		const [expected] = attachment("expected-actions");
		if (result.status !== "passed" || expected === undefined) {
			// The test's own failure says why.
			return;
		}
		this.checks.push({
			test,
			expected: JSON.parse(expected) as ExpectedAction[],
			forbidden: attachment("forbidden-in-actions"),
		});
	}

	async onEnd(): Promise<{ status?: FullResult["status"] } | undefined> {
		for (const check of this.checks) {
			try {
				const { screenshots, actions } = await readScreenshotsZip(
					await openAsBlob(traceZipPath(check.test)),
				);
				const problems = actions
					? [
							...compareActions(actions, check.expected),
							...checkFile(actions, check.forbidden, [
								...new Set(screenshots.map((screenshot) => screenshot.pageId)),
							]),
						]
					: ["the trace ZIP has no actions.json"];
				this.problems.push(
					...problems.map((problem) => `${check.test.title}: ${problem}`),
				);
			} catch (error) {
				this.problems.push(`${check.test.title}: ${String(error)}`);
			}
		}
		if (this.problems.length === 0) {
			return undefined;
		}
		console.error(
			`actions.json isn't what the tests expect:\n${this.problems.join("\n")}`,
		);
		return { status: "failed" };
	}

	printsToStdio(): boolean {
		return false;
	}
}

function compareActions(
	file: ActionsFile,
	expected: ExpectedAction[],
): string[] {
	const summary = file.actions.map((action) => action.method).join(", ");
	if (file.actions.length !== expected.length) {
		return [
			`expected ${expected.length} actions, found ${file.actions.length} (${summary})`,
		];
	}
	return expected.flatMap((want, index) =>
		compareAction(file.actions[index], want, file.actions[index + 1]).map(
			(problem) => `action ${index} (${want.method}): ${problem}`,
		),
	);
}

function compareAction(
	action: RecordedAction,
	want: ExpectedAction,
	next: RecordedAction | undefined,
): string[] {
	const problems: string[] = [];
	const first = action.inputs[0];
	const last = action.inputs[action.inputs.length - 1];
	const expect = (ok: boolean, problem: string) => {
		if (!ok) problems.push(`${problem}; recorded ${JSON.stringify(action)}`);
	};

	expect(action.method === want.method, `method is ${action.method}`);
	expect(
		action.pageId === (want.pageId ?? "page-0"),
		`pageId is ${action.pageId}`,
	);
	expect(action.failed === want.failed, `failed is ${action.failed}`);
	const inputs = want.inputs ?? 1;
	expect(
		inputs === "several"
			? action.inputs.length > 1
			: action.inputs.length === inputs,
		`has ${action.inputs.length} inputs`,
	);
	if (want.box !== undefined) {
		expect(
			sameBox(last.box, want.box),
			`box isn't ${JSON.stringify(want.box)}`,
		);
	}
	if (want.firstBox) {
		expect(
			sameBox(first.box, want.firstBox),
			`first box isn't ${JSON.stringify(want.firstBox)}`,
		);
	}
	if (want.point !== undefined) {
		expect(
			samePoint(last.point, want.point),
			`point isn't ${JSON.stringify(want.point)}`,
		);
	}
	if (last.point && last.box) {
		expect(inside(last.point, last.box), "point is outside its box");
	}

	if (want.moved === true) {
		expect(
			action.steadySince === undefined &&
				action.steadyFrom === (last.point ? last.time : action.end),
			"isn't known to have moved its element",
		);
	} else if (want.moved === false) {
		expect(
			last.point
				? action.steadySince !== undefined && action.steadySince <= last.time
				: action.steadyFrom === undefined || action.steadyFrom < last.time,
			"isn't known to have left its element where it was",
		);
	}

	const steady = action.steadyUntil;
	switch (want.steady) {
		case "held":
			expect(
				steady !== undefined && steady >= action.end,
				"element wasn't seen in place after the call",
			);
			break;
		case "lost":
			expect(
				steady !== undefined && steady >= last.time && steady < action.end,
				"element was seen in place after the call",
			);
			break;
		case "until-next-action":
			expect(
				steady !== undefined &&
					steady >= action.end &&
					next !== undefined &&
					steady <= next.inputs[0].time,
				"element wasn't seen in place from the call's end to no later than the next input",
			);
			break;
		case "none":
			expect(steady === undefined, "steadyUntil is set");
			break;
	}
	return problems;
}

/** What holds for every actions.json, whatever the test did. */
function checkFile(
	file: ActionsFile,
	forbidden: string[],
	pageIds: string[],
): string[] {
	const problems: string[] = [];
	const text = JSON.stringify(file);
	for (const secret of forbidden) {
		if (text.includes(secret)) {
			problems.push(`holds the input value "${secret}"`);
		}
	}
	let previousStart = Number.NEGATIVE_INFINITY;
	for (const action of file.actions) {
		const times = action.inputs.map((input) => input.time);
		if (times[0] < previousStart) {
			problems.push("actions aren't ordered by their first input");
		}
		previousStart = times[0];
		if (times.some((time, index) => index > 0 && time < times[index - 1])) {
			problems.push(`${action.method}: inputs aren't in order`);
		}
		if (action.end < times[times.length - 1]) {
			problems.push(`${action.method}: ends before its last input`);
		}
		if (!pageIds.includes(action.pageId)) {
			problems.push(`${action.method}: no screenshots of ${action.pageId}`);
		}
	}
	return problems;
}

function sameBox(box: ActionBox | undefined, want: ActionBox | null): boolean {
	if (!box || !want) {
		return !box && !want;
	}
	return (
		close(box.x, want.x) &&
		close(box.y, want.y) &&
		close(box.width, want.width) &&
		close(box.height, want.height)
	);
}

function samePoint(
	point: ActionPoint | undefined,
	want: ActionPoint | null,
): boolean {
	if (!point || !want) {
		return !point && !want;
	}
	return close(point.x, want.x) && close(point.y, want.y);
}

function inside(point: ActionPoint, box: ActionBox): boolean {
	return (
		point.x >= box.x - TOLERANCE_PX &&
		point.x <= box.x + box.width + TOLERANCE_PX &&
		point.y >= box.y - TOLERANCE_PX &&
		point.y <= box.y + box.height + TOLERANCE_PX
	);
}

function close(a: number, b: number): boolean {
	return Math.abs(a - b) <= TOLERANCE_PX;
}

function traceZipPath(test: TestCase): string {
	const project = test.parent.project();
	if (!project) {
		throw new Error(`No project for test "${test.id}"`);
	}
	return path.join(
		project.outputDir,
		`${path.basename(test.location.file)}:${test.location.line}-${test.id}-pw-otel.zip`,
	);
}
