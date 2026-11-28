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
	await viewer.leaveOpeningStep();
	const { stepViewer } = viewer;
	const lockedLine = viewer.root.locator("[data-locked-time-line]");
	const plot = page.locator("[data-timeline-plot]");

	const expectLineInView = async () => {
		const plotBox = (await plot.boundingBox())!;
		const lineBox = (await lockedLine.boundingBox())!;
		expect(lineBox.x).toBeGreaterThanOrEqual(plotBox.x - 2);
		expect(lineBox.x).toBeLessThanOrEqual(plotBox.x + plotBox.width);
	};

	/**
	 * The step counter during playback: Login runs 600-1800 and shows its
	 * result until Check dashboard starts at 2000, which then stays on.
	 */
	const playingPosition = (timeMs: number) =>
		timeMs < 600 ? "–/2" : timeMs < 2000 ? "1/2" : "2/2";
	const expectPositionAtLockedTime = async () => {
		const timeMs = await timeMsOf(lockedLine);
		await expect(stepViewer.position).toHaveText(playingPosition(timeMs));
		if (timeMs >= 600) {
			await expect(stepViewer.position).toHaveAttribute("data-active", "true");
			// The caption names the step playing, as it does on a stop.
			await expect(stepViewer.stepTitle).toHaveText(
				timeMs < 2000 ? "Login" : "Check dashboard",
			);
		} else {
			await expect(stepViewer.step).toBeHidden();
		}
	};

	/** Real time and trace time that pass while playing for about a second. */
	const measurePlayback = async () => {
		const startTimeMs = await timeMsOf(lockedLine);
		const startedAt = Date.now();
		await page.waitForTimeout(1000);
		const endTimeMs = await timeMsOf(lockedLine);
		return { traceMs: endTimeMs - startTimeMs, realMs: Date.now() - startedAt };
	};

	await test.step("A trace without actions has none to hold on", async () => {
		await expect(stepViewer.holdsButton).toHaveCount(0);
	});

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
		// Paused, the counter still shows the step playback is on.
		await expectPositionAtLockedTime();
	});

	await test.step("Playing at double speed resumes from there and keeps the time in view", async () => {
		const pausedAt = await timeMsOf(lockedLine);
		await stepViewer.speedButton.click();
		await stepViewer.speedButton.click();
		await expect(stepViewer.speedButton).toHaveText("2×");
		await stepViewer.playButton.click();
		// Playing lights up the counter with the step playing, like stepping.
		await expect(stepViewer.position).toHaveAttribute("data-active", "true");

		const { traceMs, realMs } = await measurePlayback();
		expect(await timeMsOf(lockedLine)).toBeGreaterThan(pausedAt);
		expect(traceMs).toBeGreaterThan(realMs * 2 * 0.5);
		expect(traceMs).toBeLessThanOrEqual(realMs * 2 + 50);
		await expectLineInView();
	});

	await test.step("Playback stops at the end of the trace, on its last screenshot", async () => {
		await expect(stepViewer.playButton).toBeVisible({ timeout: 5000 });
		expect(await timeMsOf(lockedLine)).toBe(4000);
		await expect(stepViewer.position).toHaveText("2/2");
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
		await expect(stepViewer.position).toHaveText("–/2");
		await expect(stepViewer.position).not.toHaveAttribute("data-active");
	});

	await test.step("Space plays and pauses", async () => {
		// Clicking the play button left focus on it; give keys to the page.
		await stepViewer.playButton.blur();
		await page.keyboard.press("Space");
		await expect(stepViewer.pauseButton).toBeVisible();
		await page.keyboard.press("Space");
		await expect(stepViewer.playButton).toBeVisible();
	});

	await test.step("Clicking the screen plays and pauses", async () => {
		await stepViewer.screen.click();
		await expect(stepViewer.pauseButton).toBeVisible();
		await stepViewer.screen.click();
		await expect(stepViewer.playButton).toBeVisible();
	});

	await test.step("The counter follows playback from step to step", async () => {
		await stepViewer.speedButton.click();
		await expect(stepViewer.speedButton).toHaveText("0.5×");
		await stepViewer.playButton.click();
		await expect(stepViewer.position).toHaveText("1/2");
		await expect(stepViewer.position).toHaveAttribute("data-active", "true");
		await stepViewer.pauseButton.click();
		await expectPositionAtLockedTime();
	});

	await test.step("Arrow keys step on from the step playback is on", async () => {
		await expect(stepViewer.position).toHaveText("1/2");
		await page.keyboard.press("ArrowRight");
		// Now on the second step's stop, focused in the details panel.
		await expect(stepViewer.position).toHaveText("2/2");
		await expect(viewer.details.focusedCards).toHaveAttribute(
			"data-span-id",
			(await stepViewer.step.getAttribute("data-span-id"))!,
		);
		await expect(stepViewer.playButton).toBeVisible();
	});

	await test.step("Stepping through steps takes over from playback", async () => {
		// From the first stop, with half the test still to play.
		await page.keyboard.press("Home");
		await stepViewer.playButton.click();
		await expect(stepViewer.pauseButton).toBeVisible();
		await stepViewer.previousButton.click();
		await expect(stepViewer.playButton).toBeVisible();
		await expect(stepViewer.position).toHaveAttribute("data-active", "true");
		// Back on that stop, not carried on to the end.
		await expect(lockedLine).toHaveAttribute("data-time-ms", "1999");
	});

	await test.step("Seeking on the ruler pauses at the time sought", async () => {
		await page.keyboard.press("Home");
		await stepViewer.playButton.click();
		await expect(stepViewer.pauseButton).toBeVisible();
		await viewer.ruler.clickAt(0.25);
		await expect(stepViewer.playButton).toBeVisible();
		const seekMs = await timeMsOf(lockedLine);
		expect(seekMs).toBeGreaterThan(900);
		expect(seekMs).toBeLessThan(1100);
	});
});

test("holds on each action while playing", async ({ page, request }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();

	const builder = new TraceDataBuilder(traceId, testStartTime).addTestSpan(
		"Holds",
		4000,
	);
	builder.addStepSpanAndGetId("Before Hooks", 500, { startOffsetMs: 0 });
	const step = (title: string, startOffsetMs: number) =>
		builder.addStepSpanAndGetId(title, 10, {
			startOffsetMs,
			attributes: { "test.step.category": "pw:api" },
		});
	step("Fill", 995);
	step("Click", 1005);
	step("Click", 2495);
	builder.addStepSpanAndGetId("After Hooks", 400, { startOffsetMs: 3500 });
	await builder.send(request);

	const box = { x: 540, y: 310, width: 200, height: 100 };
	const actionAt = (startMs: number, method: string) => ({
		pageId: "page-0",
		start: testStartTime + startMs,
		end: testStartTime + startMs + 4,
		method,
		box,
		...(method === "click" ? { point: { x: 640, y: 360 } } : {}),
	});
	const screenshotsZip = await createScreenshotsZipFromOffsets({
		testStartTime,
		screenshotOffsetsMs: [100, 900, 1100, 2400, 2600, 3600],
		pageId: "page-0",
		viewport: { width: 1280, height: 720 },
		// A fill and a click on each other's heels, then a click on its own.
		actions: [
			actionAt(1000, "fill"),
			actionAt(1010, "click"),
			actionAt(2500, "click"),
		],
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
	await viewer.leaveOpeningStep();
	const { stepViewer, ruler } = viewer;
	const lockedLine = viewer.root.locator("[data-locked-time-line]");
	const overlay = stepViewer.actionOverlay;

	const expectHeldAt = async (timeMs: number) => {
		await expect(stepViewer.holdsButton).toHaveAttribute(
			"data-holding",
			"true",
		);
		await expect(lockedLine).toHaveAttribute("data-time-ms", String(timeMs));
	};
	const expectMoving = async () => {
		await expect(stepViewer.pauseButton).toBeVisible();
		await expect(stepViewer.holdsButton).not.toHaveAttribute("data-holding");
	};

	await test.step("With actions to hold on, playback holds and moves at double speed", async () => {
		await expect(stepViewer.holdsButton).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expect(stepViewer.speedButton).toHaveText("2×");
	});

	// From here the page's clock only moves when told to, so each part of a
	// hold can be looked at. Holds last 380 + 320 ms; 200 + 180 ms between
	// actions close together.
	await page.clock.install();
	await page.clock.pauseAt(Date.now() + 1000);

	await test.step("Playback waits where an action is about to land, then with it landed", async () => {
		// From 2200 ms, 150 ms away at double speed.
		await ruler.clickAt(0.55);
		await stepViewer.playButton.click();
		await page.clock.runFor(250);
		await expectHeldAt(2500);
		// First only where the click is going: the element and a closing ring.
		await expect(overlay).toHaveAttribute("data-hold-phase", "aim");
		await expect(overlay.getByTestId("action-overlay-aim")).toBeVisible();
		await expect(overlay.getByTestId("action-overlay-box")).toBeVisible();
		await expect(overlay.getByTestId("action-overlay-point")).toHaveCount(0);

		// Then the click itself, at the same moment of the test.
		await page.clock.runFor(380);
		await expectHeldAt(2500);
		await expect(overlay).toHaveAttribute("data-hold-phase", "landed");
		await expect(overlay.getByTestId("action-overlay-point")).toBeVisible();
		await expect(overlay.getByTestId("action-overlay-landed")).toBeVisible();
		await expect(overlay.getByTestId("action-overlay-aim")).toHaveCount(0);

		// It moves on by itself once the hold is over.
		await page.clock.runFor(400);
		await expectMoving();
		expect(await timeMsOf(lockedLine)).toBeGreaterThan(2500);
		await expect(overlay).not.toHaveAttribute("data-hold-phase");
		await stepViewer.pauseButton.click();
	});

	await test.step("Pausing on a hold keeps it, and playing again finishes it", async () => {
		await ruler.clickAt(0.55);
		await stepViewer.playButton.click();
		await page.clock.runFor(250);
		await expectHeldAt(2500);
		await stepViewer.pauseButton.click();
		await page.clock.runFor(1000);
		await expect(lockedLine).toHaveAttribute("data-time-ms", "2500");
		await expect(overlay).toHaveAttribute("data-hold-phase", "aim");

		// It takes up the hold where it was: starting over, it would still be
		// aiming after this long.
		await stepViewer.playButton.click();
		await page.clock.runFor(360);
		await expectHeldAt(2500);
		await expect(overlay).toHaveAttribute("data-hold-phase", "landed");
		await stepViewer.pauseButton.click();
	});

	await test.step("Seeking away from a hold ends it", async () => {
		await expect(overlay).toHaveAttribute("data-hold-phase", "landed");
		await ruler.clickAt(0.2);
		await expect(stepViewer.holdsButton).not.toHaveAttribute("data-holding");
		await expect(overlay).toHaveCount(0);
	});

	await test.step("Actions close together are each held on, for less", async () => {
		// From 800 ms, 100 ms away at double speed.
		await ruler.clickAt(0.2);
		await stepViewer.playButton.click();
		await page.clock.runFor(180);
		await expectHeldAt(1000);
		await expect(overlay).toHaveAttribute("data-method", "fill");
		await expect(overlay).toHaveAttribute("data-hold-phase", "aim");
		// A fill has no point: only its element is marked.
		await expect(overlay.getByTestId("action-overlay-aim")).toHaveCount(0);

		// On to the click 10 ms later, after 560 ms on the fill.
		await page.clock.runFor(560);
		await expectHeldAt(1010);
		await expect(overlay).toHaveAttribute("data-method", "click");
		await expect(overlay).toHaveAttribute("data-hold-phase", "aim");
		// Aiming for 200 ms this time.
		await page.clock.runFor(200);
		await expect(overlay).toHaveAttribute("data-hold-phase", "landed");
		await page.clock.runFor(400);
		await expectMoving();
		await stepViewer.pauseButton.click();
	});

	await test.step("With holds off, playback runs straight through at normal speed", async () => {
		await stepViewer.holdsButton.click();
		await expect(stepViewer.holdsButton).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		await expect(stepViewer.speedButton).toHaveText("1×");

		await ruler.clickAt(0.2);
		await stepViewer.playButton.click();
		await page.clock.runFor(420);
		await expectMoving();
		const timeMs = await timeMsOf(lockedLine);
		expect(timeMs).toBeGreaterThan(1100);
		expect(timeMs).toBeLessThan(1300);
		await stepViewer.pauseButton.click();
	});

	await page.clock.resume();

	await test.step("The choice is kept for the next trace", async () => {
		await page.reload();
		await expect(stepViewer.holdsButton).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		await stepViewer.holdsButton.click();
		await expect(stepViewer.speedButton).toHaveText("2×");
		// A chosen speed stays, with holds or without.
		await stepViewer.speedButton.click();
		await expect(stepViewer.speedButton).toHaveText("0.5×");
		await stepViewer.holdsButton.click();
		await expect(stepViewer.speedButton).toHaveText("0.5×");
		await page.reload();
		await expect(stepViewer.speedButton).toHaveText("0.5×");
	});
});
