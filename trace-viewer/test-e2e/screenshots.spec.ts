import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { MULTI_CONTEXT_SCREENSHOTS_TRACE_ID_FILE } from "./setup/global-setup";
import { createScreenshotsZipFromOffsets } from "./screenshot-zip";
import { TraceDataBuilder } from "./test-data-builder";

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
});

async function uploadScreenshots(
	request: APIRequestContext,
	traceId: string,
	testStartTime: number,
	screenshotOffsetsMs: number[],
): Promise<void> {
	const zip = await createScreenshotsZipFromOffsets({
		testStartTime,
		screenshotOffsetsMs,
	});
	const upload = await request.put(
		`${TRACE_API_URL}/playwright-otel-reporter/v1/screenshots.zip`,
		{
			data: Buffer.from(await zip.arrayBuffer()),
			headers: { "Content-Type": "application/zip", "X-Trace-Id": traceId },
		},
	);
	expect(upload.ok()).toBeTruthy();
}

/** The latest of the offsets at or before a time, as an absolute timestamp */
function frameAt(
	testStartTime: number,
	offsetsMs: number[],
	timeMs: number,
): string {
	const offset = offsetsMs.filter((offsetMs) => offsetMs <= timeMs).at(-1);
	if (offset === undefined) throw new Error(`No frame at ${timeMs}ms`);
	return String(testStartTime + offset);
}

test("the ruler's filmstrip shows a row per browser page", async ({ page }) => {
	const traceId = readFileSync(
		MULTI_CONTEXT_SCREENSHOTS_TRACE_ID_FILE,
		"utf-8",
	).trim();
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	const { ruler, stepViewer } = viewer;
	await expect(stepViewer.screenshot).toBeVisible({ timeout: 10000 });

	await ruler.hoverAt(0.9);
	const rows = ruler.filmstrip.rows();
	await expect(rows).toHaveCount(2, { timeout: 10000 });
	const rowPageIds = await rows.evaluateAll((elements) =>
		elements.map((element) => element.getAttribute("data-screenshot-page-id")),
	);
	expect(new Set(rowPageIds).size).toBe(2);

	for (let rowIndex = 0; rowIndex < 2; rowIndex++) {
		const image = rows
			.nth(rowIndex)
			.locator("img[data-screenshot-timestamp]")
			.last();
		await expect(image).toBeVisible();
		await expect
			.poll(() =>
				image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
			)
			.toBeGreaterThan(0);
	}
	// The frame under the pointer is ringed in each row.
	await expect(ruler.filmstrip.framesUnderPointer).toHaveCount(2);
});

test("the filmstrip lines up in time with the ruler and names the step under the pointer", async ({
	page,
	request,
}) => {
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();
	const offsetsMs = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500];
	const builder = new TraceDataBuilder(traceId, testStartTime).addTestSpan(
		"Ruler filmstrip",
		4000,
	);
	builder.addStepSpanAndGetId("Before Hooks", 400, { startOffsetMs: 0 });
	builder.addStepSpanAndGetId("Open page", 500, {
		startOffsetMs: 500,
		attributes: { "test.step.subtitle": "example.com" },
	});
	builder.addStepSpanAndGetId("Inspect page", 2000, { startOffsetMs: 1200 });
	await builder.send(request);
	await uploadScreenshots(request, traceId, testStartTime, offsetsMs);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	const { ruler, stepViewer } = viewer;
	const { filmstrip } = ruler;
	await expect(stepViewer.screenshot).toBeVisible({ timeout: 10000 });
	await viewer.leaveOpeningStep();

	await test.step("Hidden until the pointer is on the ruler", async () => {
		await expect(filmstrip.root).toBeHidden();
		await stepViewer.screen.hover();
		await expect(filmstrip.root).toBeHidden();
	});

	await test.step("Spans the plot, with the frame under the pointer at the pointer's time", async () => {
		await ruler.hoverAt(0.55);
		await expect(filmstrip.root).toBeVisible();
		const plot = (await ruler.bar.boundingBox())!;
		const frames = filmstrip.rows().first().locator("> div");
		const first = (await frames.first().boundingBox())!;
		const last = (await frames.last().boundingBox())!;
		expect(first.x).toBeCloseTo(plot.x, 0);
		expect(last.x + last.width).toBeGreaterThan(plot.x + plot.width - 8);
		expect(last.x + last.width).toBeLessThanOrEqual(plot.x + plot.width + 1);

		const ringed = filmstrip.framesUnderPointer;
		await expect(ringed).toHaveCount(1);
		const ringedBox = (await ringed.boundingBox())!;
		const { x } = await ruler.pointAt(0.55);
		expect(ringedBox.x).toBeLessThanOrEqual(x);
		expect(ringedBox.x + ringedBox.width).toBeGreaterThanOrEqual(x);
		await expect(ringed.locator("img")).toHaveAttribute(
			"data-screenshot-timestamp",
			frameAt(testStartTime, offsetsMs, 0.55 * 4000),
		);
	});

	await test.step("Labels and shades the step under the pointer", async () => {
		await expect(filmstrip.label).toHaveText("2. Inspect page · 2.2s");
		await expect(filmstrip.range).toHaveAttribute("data-start-ms", "1200");
		await expect(filmstrip.range).toHaveAttribute("data-end-ms", "3200");
		const range = (await filmstrip.range.boundingBox())!;
		const segment = (await ruler.steps.nth(1).boundingBox())!;
		expect(Math.abs(range.x - segment.x)).toBeLessThan(2);

		await ruler.hoverAt(0.17);
		await expect(filmstrip.label).toHaveText(
			"1. Open page example.com · 680ms",
		);
		await ruler.hoverAt(0.05);
		await expect(filmstrip.label).toHaveText("Before hooks · 200ms");
		await expect(filmstrip.range).toHaveAttribute("data-start-ms", "0");
	});

	await test.step("With nothing locked, the screenshot follows the pointer on the ruler", async () => {
		await ruler.hoverAt(0.3);
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			frameAt(testStartTime, offsetsMs, 0.3 * 4000),
		);
		await ruler.hoverAt(0.8);
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			frameAt(testStartTime, offsetsMs, 0.8 * 4000),
		);
		await expect(viewer.details.screenshot()).toHaveAttribute(
			"data-screenshot-timestamp",
			frameAt(testStartTime, offsetsMs, 0.8 * 4000),
		);
	});

	await test.step("Locked, the screenshot stays while the filmstrip follows", async () => {
		await page.keyboard.press("End");
		await expect(stepViewer.position).toHaveText("2/2");
		const locked = frameAt(testStartTime, offsetsMs, 3200);
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			locked,
		);
		await ruler.hoverAt(0.3);
		await expect(filmstrip.framesUnderPointer.locator("img")).toHaveAttribute(
			"data-screenshot-timestamp",
			frameAt(testStartTime, offsetsMs, 0.3 * 4000),
		);
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			locked,
		);
	});

	await test.step("Leaving the ruler hides it", async () => {
		await stepViewer.screen.hover();
		await expect(filmstrip.root).toBeHidden();
	});
});

test("the frame under the pointer shows the latest screenshot even when the filmstrip samples them", async ({
	page,
	request,
}) => {
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();
	const testDurationMs = 10_000;
	const offsetsMs = Array.from({ length: 101 }, (_, index) => index * 100);
	await new TraceDataBuilder(traceId, testStartTime)
		.addTestSpan("Dense screenshots", testDurationMs)
		.addStepSpan("Interact with the page", testDurationMs, { startOffsetMs: 0 })
		.send(request);
	await uploadScreenshots(request, traceId, testStartTime, offsetsMs);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	const { ruler } = viewer;
	await expect(viewer.stepViewer.screenshot).toBeVisible({ timeout: 10000 });
	await viewer.leaveOpeningStep();

	await ruler.hoverAt(0.437);
	await expect(ruler.filmstrip.root).toBeVisible();
	// Far fewer frames fit than were taken, so most are left out...
	await expect
		.poll(() => ruler.filmstrip.screenshots().count())
		.toBeLessThan(offsetsMs.length / 2);
	// ...but the one under the pointer is the frame at the pointer.
	const expected = frameAt(testStartTime, offsetsMs, 0.437 * testDurationMs);
	await expect(
		ruler.filmstrip.framesUnderPointer.locator("img"),
	).toHaveAttribute("data-screenshot-timestamp", expected);
	await expect(viewer.details.screenshot()).toHaveAttribute(
		"data-screenshot-timestamp",
		expected,
	);
});

test("Escape over the ruler drops the previously locked span", async ({
	page,
	request,
}) => {
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();
	const builder = new TraceDataBuilder(traceId, testStartTime).addTestSpan(
		"Unlock over the ruler",
		4000,
	);
	const lateStepId = builder.addStepSpanAndGetId("Late step", 100, {
		startOffsetMs: 3700,
	});
	await builder.send(request);
	await uploadScreenshots(request, traceId, testStartTime, [0, 1000, 2000]);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	await viewer.leaveOpeningStep();
	const lateStepBar = viewer.steps.spanById(lateStepId);
	const lateStepDetails = viewer.details.spanDetailsById(lateStepId);

	await lateStepBar.click();
	await expect(lateStepDetails).toBeVisible();
	await viewer.ruler.hoverAt(0.1);
	await expect(lateStepDetails).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(lateStepDetails).toHaveCount(0);
	await expect(viewer.ruler.playhead).toHaveCount(0);
});
