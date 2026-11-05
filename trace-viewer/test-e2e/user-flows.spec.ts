import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	type APIRequestContext,
	expect,
	type Locator,
	type Page,
	test,
} from "@playwright/test";
import {
	StepViewerComponent,
	TimelineRulerComponent,
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { createScreenshotsZipFromOffsets } from "./screenshot-zip";
import {
	BROWSER_PAGE_SPANS_TRACE_ZIP_PATH_FILE,
	MULTI_CONTEXT_SCREENSHOTS_TRACE_ID_FILE,
} from "./setup/global-setup";
import { TraceDataBuilder } from "./test-data-builder";

/** A 4s checkout test: three steps between its hooks, on two pages. */
async function createCheckoutTrace(
	request: APIRequestContext,
): Promise<string> {
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();
	const builder = new TraceDataBuilder(traceId, testStartTime).addTestSpan(
		"Checkout",
		4000,
	);
	builder.addStepSpanAndGetId("Before Hooks", 300, { startOffsetMs: 0 });
	builder.addStepSpanAndGetId("Open the shop", 600, { startOffsetMs: 400 });
	builder.addStepSpanAndGetId("Add to cart", 800, { startOffsetMs: 1200 });
	builder.addStepSpanAndGetId("Pay", 800, { startOffsetMs: 2200 });
	builder.addStepSpanAndGetId("After Hooks", 300, { startOffsetMs: 3400 });
	await builder.send(request);

	const zip = await createScreenshotsZipFromOffsets({
		testStartTime,
		screenshotOffsetsMs: [
			...[100, 500, 1100, 1500, 2100, 2500, 3100, 3500].map((offsetMs) => ({
				offsetMs,
				pageId: "shop",
			})),
			...[2300, 2900].map((offsetMs) => ({ offsetMs, pageId: "payment" })),
		],
	});
	const upload = await request.put(
		`${TRACE_API_URL}/playwright-otel-reporter/v1/screenshots.zip`,
		{
			data: Buffer.from(await zip.arrayBuffer()),
			headers: { "Content-Type": "application/zip", "X-Trace-Id": traceId },
		},
	);
	expect(upload.ok()).toBeTruthy();
	return traceId;
}

async function expectImageLoaded(image: Locator): Promise<void> {
	await expect(image).toBeVisible();
	await expect
		.poll(() =>
			image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
		)
		.toBeGreaterThan(0);
}

async function timeMsOf(playhead: Locator): Promise<number> {
	return Number(await playhead.getAttribute("data-time-ms"));
}

/** Moves the mouse from a point to another with the button held. */
async function drag(
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
): Promise<void> {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 6 });
	await page.mouse.up();
}

test("narrowing in on part of a test with the ruler, then seeing the whole of it again", async ({
	page,
	request,
}) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(await createCheckoutTrace(request));
	const { ruler, stepViewer } = viewer;
	const lockedLine = viewer.root.locator("[data-locked-time-line]");
	const plot = page.locator("[data-timeline-plot]");
	await expect(stepViewer.screenshot).toBeVisible({ timeout: 10000 });
	await viewer.leaveOpeningStep();
	await expect(ruler.zoomWindow).toHaveCount(0);

	const zoomWindowCenter = async () => {
		const box = (await ruler.zoomWindow.boundingBox())!;
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	};
	const barWidth = (await ruler.bar.boundingBox())!.width;

	await test.step("Dragging across the spans zooms, marked on the ruler", async () => {
		await viewer.zoomTimelineToRange(0.3, 0.6);
		await expect(ruler.zoomWindow).toBeVisible();
		await expect
			.poll(async () => (await ruler.zoomRange()).start)
			.toBeCloseTo(0.3, 1);
		await expect
			.poll(async () => (await ruler.zoomRange()).end)
			.toBeCloseTo(0.6, 1);
		// A zoom is not a selection: nothing is locked.
		await expect(ruler.playhead).toHaveCount(0);
	});

	await test.step("Clicking inside the zoom window seeks there", async () => {
		const { x, y } = await zoomWindowCenter();
		await page.mouse.click(x, y);
		await expect(ruler.playhead).toBeVisible();
		await expect(stepViewer.position).toHaveText("2/3");
		await expect(stepViewer.stepTitle).toHaveText("Add to cart");
	});

	await test.step("Seeking out of view brings that time into view", async () => {
		await ruler.clickAt(0.9);
		await expect(stepViewer.position).toHaveText("3/3");
		await expect
			.poll(async () => (await ruler.zoomRange()).end)
			.toBeGreaterThan(0.9);
		await expect
			.poll(async () => {
				const line = (await lockedLine.boundingBox())!;
				const box = (await plot.boundingBox())!;
				return line.x >= box.x && line.x <= box.x + box.width;
			})
			.toBe(true);
	});

	await test.step("The zoom window pans without moving the time", async () => {
		const timeMs = await timeMsOf(ruler.playhead);
		const before = await ruler.zoomRange();
		const from = await zoomWindowCenter();
		await drag(page, from, { x: from.x - barWidth * 0.2, y: from.y });
		await expect
			.poll(async () => (await ruler.zoomRange()).start)
			.toBeCloseTo(before.start - 0.2, 1);
		expect(await timeMsOf(ruler.playhead)).toBe(timeMs);
	});

	await test.step("The zoom window's handles widen it", async () => {
		const before = await ruler.zoomRange();
		const { y } = await zoomWindowCenter();
		const box = (await ruler.zoomWindow.boundingBox())!;
		await drag(
			page,
			{ x: box.x + box.width, y },
			{ x: box.x + box.width + barWidth * 0.1, y },
		);
		await expect
			.poll(async () => (await ruler.zoomRange()).end)
			.toBeCloseTo(before.end + 0.1, 1);
		await drag(page, { x: box.x, y }, { x: box.x - barWidth * 0.1, y });
		await expect
			.poll(async () => (await ruler.zoomRange()).start)
			.toBeCloseTo(before.start - 0.1, 1);
	});

	await test.step("A scrub carries on past the end of the ruler", async () => {
		const from = await ruler.pointAt(0.5);
		const box = (await ruler.bar.boundingBox())!;
		await drag(page, from, {
			x: box.x + box.width + 6,
			y: from.y + 240,
		});
		await expect(ruler.playhead).toHaveAttribute("data-time-ms", "4000");
		await expect(stepViewer.position).toHaveText("3/3");
		// Released away from it, the ruler's filmstrip has gone.
		await expect(ruler.filmstrip.root).toBeHidden();
	});

	await test.step("Double-clicking the ruler shows the whole test, with nothing locked", async () => {
		const { x, y } = await ruler.pointAt(0.5);
		await page.mouse.dblclick(x, y);
		await expect(ruler.zoomWindow).toHaveCount(0);
		await expect(ruler.playhead).toHaveCount(0);
		await expect(lockedLine).toHaveCount(0);
	});
});

test("following a real test across its two pages, by step and by playing it", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const traceId = readFileSync(
		MULTI_CONTEXT_SCREENSHOTS_TRACE_ID_FILE,
		"utf-8",
	).trim();
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	const { ruler, stepViewer } = viewer;
	await expectImageLoaded(stepViewer.screenshot);
	await expect(stepViewer.position).toHaveText(/^\d+\/\d+$/);
	const stopCount = Number(
		(await stepViewer.position.textContent())?.split("/")[1],
	);
	expect(stopCount).toBeGreaterThan(5);

	await test.step("Stepping walks every step in order, each with its details", async () => {
		await page.keyboard.press("Home");
		for (let stop = 1; stop <= stopCount; stop++) {
			if (stop > 1) await page.keyboard.press("ArrowRight");
			await expect(stepViewer.position).toHaveText(`${stop}/${stopCount}`);
			await expect(viewer.details.focusedCards).toHaveAttribute(
				"data-span-id",
				(await stepViewer.step.getAttribute("data-span-id"))!,
			);
			await expectImageLoaded(stepViewer.screenshot);
		}
		await expect(stepViewer.nextButton).toBeDisabled();
	});

	await test.step("Picking a page keeps it on screen through the steps", async () => {
		await expect(stepViewer.pagePicker.getByRole("button")).toHaveCount(2);
		await stepViewer.page(1).click();
		const pinnedPageId =
			await stepViewer.screenshot.getAttribute("data-page-id");
		await page.keyboard.press("Home");
		await expect(stepViewer.position).toHaveText(`1/${stopCount}`);
		await page.keyboard.press("End");
		await expect(stepViewer.position).toHaveText(`${stopCount}/${stopCount}`);
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-page-id",
			pinnedPageId!,
		);
		await stepViewer.page(1).click();
	});

	await test.step("Playing runs through the test to its end", async () => {
		await page.keyboard.press("Home");
		await stepViewer.speedButton.click();
		await expect(stepViewer.speedButton).toHaveText("2×");
		await stepViewer.playButton.click();
		await expect(stepViewer.pauseButton).toBeVisible();
		await expect(stepViewer.position).toHaveText(`${stopCount}/${stopCount}`, {
			timeout: 15000,
		});
		await expect(stepViewer.playButton).toBeVisible({ timeout: 15000 });
		await expect.poll(() => ruler.filledRatio()).toBeCloseTo(1, 2);
	});

	await test.step("Hovering the ruler names steps and shows both pages", async () => {
		await page.keyboard.press("Escape");
		await ruler.hoverAt(0.5);
		await expect(ruler.filmstrip.label).toHaveText(/^\d+\. .+ · .+$/);
		await expect(ruler.filmstrip.rows()).toHaveCount(2);
	});
});

test("opening a trace file and stepping through it in the player", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromZip(
		readFileSync(BROWSER_PAGE_SPANS_TRACE_ZIP_PATH_FILE, "utf-8").trim(),
	);
	const { ruler, stepViewer } = viewer;
	await expect(viewer.header.testName).toBeVisible();
	// Screenshots come out of the file, through the service worker.
	await expectImageLoaded(stepViewer.screenshot);

	await page.keyboard.press("Home");
	await expect(stepViewer.position).toHaveText(/^1\/\d+$/);
	await expect(stepViewer.stepTitle).not.toBeEmpty();

	await page.keyboard.press("End");
	await expect(stepViewer.position).toHaveAttribute("data-active", "true");
	await expectImageLoaded(stepViewer.screenshot);

	await ruler.clickAt(0.5);
	await expect(ruler.playhead).toBeVisible();
	await expectImageLoaded(stepViewer.screenshot);
	await expect(ruler.filmstrip.rows().first()).toBeVisible();
	await expectImageLoaded(ruler.filmstrip.screenshots().last());
});

test("watching a test in a player embedded on another site", async ({
	page,
	request,
	baseURL,
}) => {
	await page.setViewportSize({ width: 1100, height: 700 });
	const traceId = await createCheckoutTrace(request);
	const params = new URLSearchParams({
		traceSource: `${TRACE_API_URL}/playwright-otel-trace-viewer/v1/${traceId}`,
		view: "player",
	});

	// Another origin from the viewer's, embedding it as an iframe.
	await page.goto(`${TRACE_API_URL}/health`);
	await page.setContent(
		`<h1>Our test report</h1><iframe title="Test replay" src="${baseURL}/?${params}" style="width:960px;height:540px;border:0"></iframe>`,
	);
	const frame = page.frameLocator('iframe[title="Test replay"]');
	const stepViewer = new StepViewerComponent(frame);
	const ruler = new TimelineRulerComponent(page, frame);

	await test.step("Only the player shows, on its first screenshot", async () => {
		await expectImageLoaded(stepViewer.screenshot);
		await expect(ruler.root).toBeVisible();
		await expect(frame.getByTestId("trace-viewer-header")).toHaveCount(0);
		await expect(
			frame.getByRole("region", { name: "Trace timeline" }),
		).toHaveCount(0);
		await expect(stepViewer.position).toHaveText("–/3");
	});

	await test.step("The controls step and play", async () => {
		await stepViewer.nextButton.click();
		await expect(stepViewer.position).toHaveText("1/3");
		await expect(stepViewer.stepTitle).toHaveText("Open the shop");
		await stepViewer.playButton.click();
		await expect(stepViewer.pauseButton).toBeVisible();
		await expect(stepViewer.position).toHaveText("2/3");
		await stepViewer.pauseButton.click();
		await expect(stepViewer.playButton).toBeVisible();
	});

	await test.step("Keys work once the player has been clicked", async () => {
		await ruler.clickAt(0.15);
		await expect(stepViewer.position).toHaveText("1/3");
		await page.keyboard.press("ArrowRight");
		await expect(stepViewer.position).toHaveText("2/3");
		await page.keyboard.press("End");
		await expect(stepViewer.position).toHaveText("3/3");
	});

	await test.step("The ruler's filmstrip shows both pages inside the frame", async () => {
		await ruler.hoverAt(0.7);
		await expect(ruler.filmstrip.rows()).toHaveCount(2);
		await expect(ruler.filmstrip.label).toHaveText(/^3\. Pay · /);
		await expectImageLoaded(ruler.filmstrip.screenshots().first());
	});

	await test.step("The page picker switches page", async () => {
		await page.mouse.move(0, 0);
		await stepViewer.page(2).click();
		await expect(stepViewer.page(2)).toHaveAttribute("aria-pressed", "true");
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-page-id",
			"payment",
		);
	});
});
