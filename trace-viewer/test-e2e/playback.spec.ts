import { randomUUID } from "node:crypto";
import { expect, type Locator, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { createScreenshotsZipFromOffsets } from "./screenshot-zip";
import { TraceDataBuilder } from "./test-data-builder";

async function timeMsOf(line: Locator): Promise<number> {
	return Number(await line.getAttribute("data-time-ms"));
}

test("plays the test back in real time at the chosen speed", async ({
	page,
	request,
}) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();

	const builder = new TraceDataBuilder(traceId, testStartTime).addTestSpan(
		"Playback",
		4000,
	);
	builder.addStepSpanAndGetId("Before Hooks", 500, { startOffsetMs: 0 });
	builder.addStepSpanAndGetId("Login", 1200, { startOffsetMs: 600 });
	builder.addStepSpanAndGetId("Check dashboard", 500, { startOffsetMs: 2000 });
	builder.addStepSpanAndGetId("After Hooks", 400, { startOffsetMs: 3500 });
	await builder.send(request);

	const screenshotsZip = await createScreenshotsZipFromOffsets({
		testStartTime,
		screenshotOffsetsMs: [100, 700, 1600, 2600, 3600],
	});
	const upload = await request.put(
		`${TRACE_API_URL}/playwright-otel-reporter/v1/screenshots.zip`,
		{
			data: Buffer.from(await screenshotsZip.arrayBuffer()),
			headers: { "Content-Type": "application/zip", "X-Trace-Id": traceId },
		},
	);
	expect(upload.ok()).toBeTruthy();

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	const { stepViewer } = viewer;
	const lockedLine = viewer.root.locator("[data-locked-time-line]");
	const plot = page.locator("[data-timeline-plot]");

	const expectLineInView = async () => {
		const plotBox = (await plot.boundingBox())!;
		const lineBox = (await lockedLine.boundingBox())!;
		expect(lineBox.x).toBeGreaterThanOrEqual(plotBox.x - 2);
		expect(lineBox.x).toBeLessThanOrEqual(plotBox.x + plotBox.width);
	};

	/** Real time and trace time that pass while playing for about a second. */
	const measurePlayback = async () => {
		const startTimeMs = await timeMsOf(lockedLine);
		const startedAt = Date.now();
		await page.waitForTimeout(1000);
		const endTimeMs = await timeMsOf(lockedLine);
		return { traceMs: endTimeMs - startTimeMs, realMs: Date.now() - startedAt };
	};

	await test.step("The speed button cycles between normal, double and half speed", async () => {
		await expect(stepViewer.speedButton).toHaveText("1×");
		await stepViewer.speedButton.click();
		await expect(stepViewer.speedButton).toHaveText("2×");
		await stepViewer.speedButton.click();
		await expect(stepViewer.speedButton).toHaveText("0.5×");
		await stepViewer.speedButton.click();
		await expect(stepViewer.speedButton).toHaveText("1×");
		// Changing speed selects nothing.
		await expect(lockedLine).toHaveCount(0);
	});

	await test.step("Playing at half speed moves the time line at half real time", async () => {
		await stepViewer.speedButton.click();
		await stepViewer.speedButton.click();
		await expect(stepViewer.speedButton).toHaveText("0.5×");
		await stepViewer.playButton.click();
		await expect(stepViewer.pauseButton).toBeVisible();
		await expect(lockedLine).toBeVisible();

		const { traceMs, realMs } = await measurePlayback();
		expect(traceMs).toBeGreaterThan(realMs * 0.5 * 0.5);
		expect(traceMs).toBeLessThanOrEqual(realMs * 0.5 + 50);
	});

	await test.step("Pausing holds the time where it is", async () => {
		await stepViewer.pauseButton.click();
		await expect(stepViewer.playButton).toBeVisible();
		const pausedAt = await timeMsOf(lockedLine);
		await page.waitForTimeout(300);
		expect(await timeMsOf(lockedLine)).toBe(pausedAt);
	});

	await test.step("Playing at double speed resumes from there and keeps the time in view", async () => {
		const pausedAt = await timeMsOf(lockedLine);
		await stepViewer.speedButton.click();
		await stepViewer.speedButton.click();
		await expect(stepViewer.speedButton).toHaveText("2×");
		await stepViewer.playButton.click();

		const { traceMs, realMs } = await measurePlayback();
		expect(await timeMsOf(lockedLine)).toBeGreaterThan(pausedAt);
		expect(traceMs).toBeGreaterThan(realMs * 2 * 0.5);
		expect(traceMs).toBeLessThanOrEqual(realMs * 2 + 50);
		await expectLineInView();
	});

	await test.step("Playback stops at the end of the trace, on its last screenshot", async () => {
		await expect(stepViewer.playButton).toBeVisible({ timeout: 5000 });
		expect(await timeMsOf(lockedLine)).toBe(4000);
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			String(testStartTime + 3600),
		);
		await expectLineInView();
	});

	await test.step("Playing from the end starts over", async () => {
		await stepViewer.playButton.click();
		await expect.poll(() => timeMsOf(lockedLine)).toBeLessThan(1000);
		await expectLineInView();
	});

	await test.step("Escape stops playback and clears the time", async () => {
		await page.keyboard.press("Escape");
		await expect(stepViewer.playButton).toBeVisible();
		await expect(lockedLine).toHaveCount(0);
	});

	await test.step("Space plays and pauses", async () => {
		// Clicking the play button left focus on it; give keys to the page.
		await stepViewer.playButton.blur();
		await page.keyboard.press("Space");
		await expect(stepViewer.pauseButton).toBeVisible();
		await page.keyboard.press("Space");
		await expect(stepViewer.playButton).toBeVisible();
	});

	await test.step("Stepping through steps takes over from playback", async () => {
		await stepViewer.playButton.click();
		await expect(stepViewer.pauseButton).toBeVisible();
		await stepViewer.nextButton.click();
		await expect(stepViewer.playButton).toBeVisible();
		await expect(stepViewer.position).toHaveAttribute("data-active", "true");
	});
});
