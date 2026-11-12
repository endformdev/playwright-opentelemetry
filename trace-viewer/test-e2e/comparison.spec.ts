import { randomUUID } from "node:crypto";
import {
	type APIRequestContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { createScreenshotsZipFromOffsets } from "./screenshot-zip";
import { TraceDataBuilder } from "./test-data-builder";

interface RunStep {
	title: string;
	subtitle: string;
	category: "pw:api" | "expect";
	line: number;
	startMs: number;
	durationMs: number;
	failed?: boolean;
}

interface Run {
	durationMs: number;
	/** The Before Hooks end and the After Hooks start here */
	bodyStartMs: number;
	bodyEndMs: number;
	status?: "passed" | "failed";
	steps: RunStep[];
	screenshots: Array<number | { offsetMs: number; pageId: string }>;
	/** When the test started, so the two runs' screenshots have their own times */
	testStartTime: number;
}

/** A run of one test on the test Trace API: its steps and screenshots. */
async function createRun(request: APIRequestContext, run: Run) {
	const traceId = randomUUID().replaceAll("-", "");
	const builder = new TraceDataBuilder(traceId, run.testStartTime).addTestSpan(
		"Compared",
		run.durationMs,
		{ status: run.status ?? "passed" },
	);
	builder.addStepSpanAndGetId("Before Hooks", run.bodyStartMs, {
		startOffsetMs: 0,
	});
	for (const step of run.steps) {
		builder.addStepSpanAndGetId(step.title, step.durationMs, {
			startOffsetMs: step.startMs,
			...(step.failed && { status: { code: 2, message: "Timed out" } }),
			attributes: {
				"test.step.category": step.category,
				"test.step.subtitle": step.subtitle,
				"code.file.path": "tests/compared.spec.ts",
				"code.line.number": String(step.line),
			},
		});
	}
	builder.addStepSpanAndGetId("After Hooks", run.durationMs - run.bodyEndMs, {
		startOffsetMs: run.bodyEndMs,
	});
	await builder.send(request);

	const zip = await createScreenshotsZipFromOffsets({
		testStartTime: run.testStartTime,
		screenshotOffsetsMs: run.screenshots,
	});
	const upload = await request.put(
		`${TRACE_API_URL}/playwright-otel-reporter/v1/screenshots.zip`,
		{
			data: Buffer.from(await zip.arrayBuffer()),
			headers: { "Content-Type": "application/zip", "X-Trace-Id": traceId },
		},
	);
	expect(upload.ok()).toBeTruthy();
	return {
		traceId,
		url: `${TRACE_API_URL}/playwright-otel-trace-viewer/v1/${traceId}`,
		/** The absolute time of a screenshot taken this far into the test */
		at: (offsetMs: number) => String(run.testStartTime + offsetMs),
	};
}

const click = (
	name: string,
	line: number,
	startMs: number,
	durationMs: number,
): RunStep => ({
	title: "Click",
	subtitle: `getByText('${name}')`,
	category: "pw:api",
	line,
	startMs,
	durationMs,
});

const check = (
	name: string,
	line: number,
	startMs: number,
	durationMs: number,
	failed = false,
): RunStep => ({
	title: 'Expect "toBeVisible"',
	subtitle: `getByText('${name}')`,
	category: "expect",
	line,
	startMs,
	durationMs,
	failed,
});

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Two passing runs of four steps, where the primary's second step took three
 * times as long. Each run takes one screenshot as it starts and one at the
 * end of each step.
 */
async function createStretchedRuns(request: APIRequestContext) {
	const now = Date.now();
	const primary = await createRun(request, {
		testStartTime: now,
		durationMs: 5000,
		bodyStartMs: 500,
		bodyEndMs: 4000,
		steps: [
			click("One", 10, 500, 500),
			click("Two", 11, 1000, 1500),
			click("Three", 12, 2500, 500),
			click("Four", 13, 3000, 500),
		],
		screenshots: [100, 950, 2450, 2950, 3450],
	});
	const comparison = await createRun(request, {
		testStartTime: now - ONE_HOUR_MS,
		durationMs: 4000,
		bodyStartMs: 500,
		bodyEndMs: 3000,
		steps: [
			click("One", 10, 500, 500),
			click("Two", 11, 1000, 500),
			click("Three", 12, 1500, 500),
			click("Four", 13, 2000, 500),
		],
		screenshots: [100, 950, 1450, 1950, 2450],
	});
	return { primary, comparison };
}

async function openComparison(
	page: Page,
	primaryUrl: string,
	params: Record<string, string>,
) {
	const query = new URLSearchParams({
		traceSource: primaryUrl,
		view: "player",
		...params,
	});
	await page.goto(`/?${query.toString()}`);
	return new TraceViewerPage(page);
}

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
});

test("follows the primary step by step", async ({ page, request }) => {
	const { primary, comparison } = await createStretchedRuns(request);
	const { stepViewer } = await openComparison(page, primary.url, {
		compareSource: comparison.url,
	});

	await test.step("Both open on their first frame", async () => {
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			primary.at(100),
		);
		await expect(stepViewer.comparisonScreenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			comparison.at(100),
		);
		await expect(stepViewer.comparison).toContainText("Baseline");
		await expect(stepViewer.comparison).toContainText("Passed");
	});

	const stops = [
		{ position: "1/4", primary: 950, comparison: 950 },
		{ position: "2/4", primary: 2450, comparison: 1450 },
		{ position: "3/4", primary: 2950, comparison: 1950 },
		{ position: "4/4", primary: 3450, comparison: 2450 },
	];
	for (const stop of stops) {
		await test.step(`At stop ${stop.position}, both show that step`, async () => {
			await stepViewer.nextButton.click();
			await expect(stepViewer.position).toHaveText(stop.position);
			await expect(stepViewer.screenshot).toHaveAttribute(
				"data-screenshot-timestamp",
				primary.at(stop.primary),
			);
			await expect(stepViewer.comparisonScreenshot).toHaveAttribute(
				"data-screenshot-timestamp",
				comparison.at(stop.comparison),
			);
			await expect(stepViewer.comparisonNote).toHaveCount(0);
		});
	}
});

test("follows hovering and playback", async ({ page, request }) => {
	const { primary, comparison } = await createStretchedRuns(request);
	const viewer = await openComparison(page, primary.url, {
		compareSource: comparison.url,
	});
	const { stepViewer, ruler } = viewer;
	await expect(stepViewer.comparisonScreenshot).toBeVisible();
	await viewer.leaveOpeningStep();

	await test.step("Hovering the ruler over step three shows the comparison's step three", async () => {
		await ruler.hoverAt(0.55);
		await expect(stepViewer.stepTitle).toHaveText("Click");
		await expect(stepViewer.position).toHaveText("3/4");
		// Both show the frame the step started from: the end of step two.
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			primary.at(2450),
		);
		await expect(stepViewer.comparisonScreenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			comparison.at(1450),
		);
		const timeMs = Number(
			await stepViewer.comparison.getAttribute("data-comparison-time-ms"),
		);
		expect(timeMs).toBeGreaterThan(1500);
		expect(timeMs).toBeLessThan(2000);
	});

	await test.step("Playing moves the comparison on", async () => {
		await page.mouse.move(0, 0);
		const before = await stepViewer.comparisonScreenshot.getAttribute(
			"data-screenshot-timestamp",
		);
		await stepViewer.playButton.click();
		await expect(stepViewer.comparisonScreenshot).not.toHaveAttribute(
			"data-screenshot-timestamp",
			before ?? "",
			{ timeout: 10000 },
		);
	});
});

test("says when the step on show has no match, wherever the pointer peeks", async ({
	page,
	request,
}) => {
	const now = Date.now();
	const primary = await createRun(request, {
		testStartTime: now,
		durationMs: 4000,
		bodyStartMs: 500,
		bodyEndMs: 3000,
		steps: [
			click("One", 10, 500, 500),
			click("New", 11, 1000, 1000),
			click("Two", 12, 2000, 500),
		],
		screenshots: [100, 950, 1950, 2450],
	});
	const comparison = await createRun(request, {
		testStartTime: now - ONE_HOUR_MS,
		durationMs: 3000,
		bodyStartMs: 500,
		bodyEndMs: 2000,
		steps: [click("One", 10, 500, 500), click("Two", 11, 1000, 500)],
		screenshots: [100, 950, 1450],
	});
	const viewer = await openComparison(page, primary.url, {
		compareSource: comparison.url,
	});
	const { stepViewer, ruler } = viewer;
	await expect(stepViewer.comparisonScreenshot).toBeVisible();

	await test.step("On the new step's stop, it has no match", async () => {
		await stepViewer.root.focus();
		await page.keyboard.press("Home");
		await page.keyboard.press("ArrowRight");
		await expect(stepViewer.position).toHaveText("2/3");
		await expect(stepViewer.comparisonNote).toHaveText("No matching step");
	});

	await test.step("Peeking at a matched step drops the note", async () => {
		await ruler.hoverAt(0.2);
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			primary.at(100),
		);
		await expect(stepViewer.comparisonNote).toHaveCount(0);
	});

	await test.step("Peeking back at the new step brings it back", async () => {
		await ruler.hoverAt(0.4);
		await expect(stepViewer.comparisonNote).toHaveText("No matching step");
	});
});

test("opens a failed run on its failure, beside the comparison's settled result of the failed step", async ({
	page,
	request,
}) => {
	const now = Date.now();
	const primary = await createRun(request, {
		testStartTime: now,
		status: "failed",
		durationMs: 7000,
		bodyStartMs: 500,
		bodyEndMs: 6000,
		steps: [click("Pay", 10, 500, 500), check("Paid", 11, 1000, 5000, true)],
		screenshots: [100, 950, 5950],
	});
	const comparison = await createRun(request, {
		testStartTime: now - ONE_HOUR_MS,
		durationMs: 2500,
		bodyStartMs: 500,
		bodyEndMs: 2000,
		steps: [
			click("Pay", 10, 500, 500),
			check("Paid", 11, 1000, 100),
			check("Receipt", 12, 1100, 50),
			click("Done", 13, 1300, 200),
		],
		// 1250 is the settled result; 1450 and 2100 come after the next action.
		screenshots: [100, 950, 1080, 1250, 1450, 2100],
	});
	const { stepViewer } = await openComparison(page, primary.url, {
		compareSource: comparison.url,
		compareLabel: "Last passing run on main",
	});
	await expect(stepViewer.comparison).toContainText("Last passing run on main");

	await expect(stepViewer.position).toHaveText("2/2");
	await expect(stepViewer.screenshot).toHaveAttribute(
		"data-screenshot-timestamp",
		primary.at(5950),
	);
	await expect(stepViewer.comparisonScreenshot).toHaveAttribute(
		"data-screenshot-timestamp",
		comparison.at(1250),
	);
	await expect(stepViewer.root).toContainText("Failed");
});

test("is unchanged without a comparison", async ({ page, request }) => {
	const { primary } = await createStretchedRuns(request);
	const { stepViewer } = await openComparison(page, primary.url, {});

	await expect(stepViewer.screenshot).toHaveAttribute(
		"data-screenshot-timestamp",
		primary.at(100),
	);
	await expect(stepViewer.comparison).toHaveCount(0);
	await expect(stepViewer.hideComparisonButton).toHaveCount(0);
	await expect(stepViewer.showComparisonButton).toHaveCount(0);
});

test("hides and shows the comparison", async ({ page, request }) => {
	const { primary, comparison } = await createStretchedRuns(request);
	const { stepViewer } = await openComparison(page, primary.url, {
		compareSource: comparison.url,
	});
	await expect(stepViewer.comparisonScreenshot).toBeVisible();

	await stepViewer.hideComparisonButton.click();
	await expect(stepViewer.comparison).toHaveCount(0);
	await expect(stepViewer.screenshot).toBeVisible();

	await stepViewer.showComparisonButton.click();
	await expect(stepViewer.comparisonScreenshot).toBeVisible();
	await expect(stepViewer.screenshot).toBeVisible();
});

test("survives a comparison that can't be loaded", async ({
	page,
	request,
}) => {
	const { primary } = await createStretchedRuns(request);
	const missingTraceId = randomUUID().replaceAll("-", "");
	const { stepViewer } = await openComparison(page, primary.url, {
		compareSource: `${TRACE_API_URL}/playwright-otel-trace-viewer/v1/${missingTraceId}`,
	});

	await expect(stepViewer.comparison).toContainText("Couldn't load this trace");
	await expect(stepViewer.hideComparisonButton).toHaveCount(0);
	await stepViewer.nextButton.click();
	await expect(stepViewer.position).toHaveText("1/4");
	await expect(stepViewer.screenshot).toHaveAttribute(
		"data-screenshot-timestamp",
		primary.at(950),
	);
});

test("sends each trace only its own token", async ({ page, request }) => {
	const { primary, comparison } = await createStretchedRuns(request);
	const requestedUrls: string[] = [];
	page.context().on("request", (sent) => requestedUrls.push(sent.url()));

	const { stepViewer } = await openComparison(page, primary.url, {
		traceToken: "token-a",
		compareSource: `${comparison.url}?traceToken=token-b`,
	});
	await expect(stepViewer.comparisonScreenshot).toBeVisible();

	await test.step("The URL carries the comparison's token on its own", async () => {
		const params = new URL(page.url()).searchParams;
		expect(params.get("traceToken")).toBe("token-a");
		expect(params.get("compareSource")).toBe(comparison.url);
		expect(params.get("compareToken")).toBe("token-b");
	});

	await test.step("Each trace's requests carry only its token", async () => {
		const toTraceApi = (traceId: string) =>
			requestedUrls.filter(
				(url) => url.startsWith(TRACE_API_URL) && url.includes(traceId),
			);
		const primaryRequests = toTraceApi(primary.traceId);
		const comparisonRequests = toTraceApi(comparison.traceId);
		expect(primaryRequests.some((url) => url.includes("/traces"))).toBe(true);
		expect(comparisonRequests.some((url) => url.includes("/traces"))).toBe(
			true,
		);
		for (const url of primaryRequests) {
			expect(url).toContain("traceToken=token-a");
			expect(url).not.toContain("token-b");
		}
		for (const url of comparisonRequests) {
			expect(url).toContain("traceToken=token-b");
			expect(url).not.toContain("token-a");
		}
	});
});

test("pairs up the pages of the two runs", async ({ page, request }) => {
	const now = Date.now();
	const steps = [click("Open", 10, 500, 500), click("Popup", 11, 1000, 500)];
	const primary = await createRun(request, {
		testStartTime: now,
		durationMs: 2500,
		bodyStartMs: 500,
		bodyEndMs: 2000,
		steps,
		screenshots: [
			{ offsetMs: 100, pageId: "page-0" },
			{ offsetMs: 950, pageId: "page-0" },
			{ offsetMs: 1100, pageId: "page-1" },
			{ offsetMs: 1450, pageId: "page-1" },
		],
	});
	// Recorded before page ids were stable: only their order pairs them up.
	const comparison = await createRun(request, {
		testStartTime: now - ONE_HOUR_MS,
		durationMs: 2500,
		bodyStartMs: 500,
		bodyEndMs: 2000,
		steps,
		screenshots: [
			{ offsetMs: 100, pageId: "page@first" },
			{ offsetMs: 950, pageId: "page@first" },
			{ offsetMs: 1100, pageId: "page@second" },
			{ offsetMs: 1450, pageId: "page@second" },
		],
	});
	const { stepViewer } = await openComparison(page, primary.url, {
		compareSource: comparison.url,
	});
	await expect(stepViewer.comparisonScreenshot).toBeVisible();

	await stepViewer.root.focus();
	await page.keyboard.press("End");
	await expect(stepViewer.screenshot).toHaveAttribute("data-page-id", "page-1");
	await expect(stepViewer.comparisonScreenshot).toHaveAttribute(
		"data-page-id",
		"page@second",
	);

	await stepViewer.page(1).click();
	await expect(stepViewer.screenshot).toHaveAttribute("data-page-id", "page-0");
	await expect(stepViewer.comparisonScreenshot).toHaveAttribute(
		"data-page-id",
		"page@first",
	);
	await expect(stepViewer.comparisonScreenshot).toHaveAttribute(
		"data-screenshot-timestamp",
		comparison.at(950),
	);
});

test("stacks the two when that makes them larger", async ({
	page,
	request,
}) => {
	const { primary, comparison } = await createStretchedRuns(request);
	const { stepViewer } = await openComparison(page, primary.url, {
		compareSource: comparison.url,
	});
	await expect(stepViewer.comparisonLayout).toHaveAttribute(
		"data-layout",
		"side-by-side",
	);

	await page.setViewportSize({ width: 480, height: 1000 });
	await expect(stepViewer.comparisonLayout).toHaveAttribute(
		"data-layout",
		"stacked",
	);
	const comparisonBox = await stepViewer.comparisonScreenshot.boundingBox();
	const primaryBox = await stepViewer.screenshot.boundingBox();
	expect(comparisonBox!.y + comparisonBox!.height).toBeLessThanOrEqual(
		primaryBox!.y,
	);
});

test("shows the comparison smaller than this run", async ({
	page,
	request,
}) => {
	const { primary, comparison } = await createStretchedRuns(request);
	const { stepViewer } = await openComparison(page, primary.url, {
		compareSource: comparison.url,
	});
	await expect(stepViewer.comparisonScreenshot).toBeVisible();
	await expect(stepViewer.screenshot).toBeVisible();

	const comparisonBox = await stepViewer.comparisonScreenshot.boundingBox();
	const primaryBox = await stepViewer.screenshot.boundingBox();
	expect(comparisonBox!.width).toBeLessThan(primaryBox!.width);
	expect(comparisonBox!.height).toBeLessThan(primaryBox!.height);
});
