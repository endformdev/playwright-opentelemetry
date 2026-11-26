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
	/** The box drawn, or null for none. Unchecked when left out. */
	box?: ActionBox | null;
	/** The point drawn, or null for none. Unchecked when left out. */
	point?: ActionPoint | null;
	/** Where a drag started: a point inside this box */
	dragFromIn?: ActionBox;
	/** The action scrolled to its element: no frame from before it shows it */
	scrolled?: true;
	/** The action took its element away: no frame from after it shows it */
	removed?: true;
	/** It may be left out, as no frame was known to show it */
	optional?: true;
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
							...checkFile(actions, check.forbidden, frameTimesOf(screenshots)),
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
	const problems: string[] = [];
	let next = 0;
	for (const [index, want] of expected.entries()) {
		const action = file.actions[next];
		if (
			!action ||
			action.method !== want.method ||
			action.pageId !== (want.pageId ?? "page-0")
		) {
			if (!want.optional) {
				problems.push(
					`action ${index} (${want.method}) is missing; recorded ${summary || "none"}`,
				);
			}
			continue;
		}
		next += 1;
		problems.push(
			...compareAction(action, want).map(
				(problem) => `action ${index} (${want.method}): ${problem}`,
			),
		);
	}
	if (next < file.actions.length) {
		problems.push(
			`expected ${expected.length} actions, found ${file.actions.length} (${summary})`,
		);
	}
	return problems;
}

function compareAction(action: RecordedAction, want: ExpectedAction): string[] {
	const problems: string[] = [];
	const expect = (ok: boolean, problem: string) => {
		if (!ok) problems.push(`${problem}; recorded ${JSON.stringify(action)}`);
	};

	expect(action.failed === want.failed, `failed is ${action.failed}`);
	if (want.box !== undefined) {
		expect(
			sameBox(action.box, want.box),
			`box isn't ${JSON.stringify(want.box)}`,
		);
	}
	if (want.point !== undefined) {
		expect(
			samePoint(action.point, want.point),
			`point isn't ${JSON.stringify(want.point)}`,
		);
	}
	if (action.point && action.box) {
		expect(inside(action.point, action.box), "point is outside its box");
	}
	if (want.dragFromIn) {
		expect(
			!!action.dragFrom && inside(action.dragFrom, want.dragFromIn),
			`drag doesn't start inside ${JSON.stringify(want.dragFromIn)}`,
		);
	} else {
		expect(action.dragFrom === undefined, "has a drag start");
	}
	if (want.scrolled) {
		expect(
			action.frames.from >= action.time,
			"is drawn on a frame from before it scrolled",
		);
	}
	if (want.removed) {
		expect(
			action.frames.until <= action.time,
			"is drawn on a frame from after it removed its element",
		);
	}
	return problems;
}

/** What holds for every actions.json, whatever the test did. */
function checkFile(
	file: ActionsFile,
	forbidden: string[],
	frameTimes: Map<string, number[]>,
): string[] {
	const problems: string[] = [];
	const text = JSON.stringify(file);
	for (const secret of forbidden) {
		if (text.includes(secret)) {
			problems.push(`holds the input value "${secret}"`);
		}
	}
	let previousTime = Number.NEGATIVE_INFINITY;
	for (const action of file.actions) {
		if (action.time < previousTime) {
			problems.push("actions aren't ordered by time");
		}
		previousTime = action.time;
		// The window names the first and last frame that show the action.
		const times = frameTimes.get(action.pageId) ?? [];
		if (
			!times.includes(action.frames.from) ||
			!times.includes(action.frames.until)
		) {
			problems.push(
				`${action.method}: its frames aren't frames of ${action.pageId}`,
			);
		}
	}
	return problems;
}

function frameTimesOf(
	screenshots: Array<{ pageId: string; timestamp: number }>,
): Map<string, number[]> {
	const times = new Map<string, number[]>();
	for (const { pageId, timestamp } of screenshots) {
		times.set(pageId, [...(times.get(pageId) ?? []), timestamp]);
	}
	return times;
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
