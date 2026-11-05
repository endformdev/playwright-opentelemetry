import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { createScreenshotsZipFromOffsets } from "./screenshot-zip";
import { TraceDataBuilder } from "./test-data-builder";

/** A 4s test with hooks and two parallel steps, and a frame every 500ms. */
async function createParallelStepsTrace(request: APIRequestContext) {
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();
	const builder = new TraceDataBuilder(traceId, testStartTime).addTestSpan(
		"Step display",
		4000,
	);
	builder.addStepSpanAndGetId("Before Hooks", 1000, { startOffsetMs: 0 });
	const first = builder.addStepSpanAndGetId("First", 500, {
		startOffsetMs: 1000,
	});
	const second = builder.addStepSpanAndGetId("Second", 1000, {
		startOffsetMs: 2000,
	});
	const third = builder.addStepSpanAndGetId("Third", 600, {
		startOffsetMs: 2200,
	});
	await builder.send(request);

	const zip = await createScreenshotsZipFromOffsets({
		testStartTime,
		screenshotOffsetsMs: [0, 500, 1000, 1500, 2000, 2500, 3000, 3500],
	});
	const upload = await request.put(
		`${TRACE_API_URL}/playwright-otel-reporter/v1/screenshots.zip`,
		{
			data: Buffer.from(await zip.arrayBuffer()),
			headers: { "Content-Type": "application/zip", "X-Trace-Id": traceId },
		},
	);
	expect(upload.ok()).toBeTruthy();
	return { traceId, first, second, third };
}

test("names the step at the moment shown, however it got there", async ({
	page,
	request,
}) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const { traceId, first, second, third } =
		await createParallelStepsTrace(request);
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	const { stepViewer, ruler } = viewer;
	await expect(stepViewer.screenshot).toBeVisible({ timeout: 10000 });
	await page.mouse.move(0, 0);

	const expectShown = async (position: string, title: string) => {
		await expect(stepViewer.position).toHaveText(position);
		await expect(stepViewer.position).toHaveAttribute("data-active", "true");
		await expect(stepViewer.stepTitle).toHaveText(title);
	};

	await test.step("With no time shown, no step is either", async () => {
		await expect(stepViewer.position).toHaveText("–/3");
		await expect(stepViewer.step).toBeHidden();
	});

	await test.step("Hovering a step on the timeline names it", async () => {
		await viewer.steps.spanById(first).hover();
		await expectShown("1/3", "First");
	});

	await test.step("A hovered step names itself among parallel steps", async () => {
		await viewer.steps.spanById(second).hover({ position: { x: 10, y: 5 } });
		await expectShown("3/3", "Second");
		await viewer.steps.spanById(third).hover();
		await expectShown("2/3", "Third");
	});

	await test.step("Hovering the ruler names the step there too", async () => {
		await ruler.hoverAt(0.3);
		await expectShown("1/3", "First");
	});

	await test.step("Along the ruler, a longer step comes back after a shorter", async () => {
		await ruler.hoverAt(0.525);
		await expectShown("3/3", "Second");
		await ruler.hoverAt(0.625);
		await expectShown("2/3", "Third");
		await ruler.hoverAt(0.725);
		await expectShown("3/3", "Second");
		// Between steps, the last one to finish stays on.
		await ruler.hoverAt(0.45);
		await expectShown("1/3", "First");
	});

	await test.step("Only the step under the pointer is picked out on the ruler", async () => {
		await ruler.hoverAt(0.625);
		// Second is drawn either side of Third.
		await expect(ruler.steps).toHaveCount(4);
		await expect(ruler.highlightedSteps).toHaveCount(1);
		await expect(ruler.highlightedSteps).toHaveAttribute("data-span-id", third);
	});

	await test.step("Stepping moves on from the step shown", async () => {
		await page.keyboard.press("ArrowRight");
		await expectShown("3/3", "Second");
	});

	await test.step("Leaving the timeline clears it, with nothing locked", async () => {
		await page.keyboard.press("Escape");
		await page.mouse.move(0, 0);
		await expect(stepViewer.position).toHaveText("–/3");
		await expect(stepViewer.step).toBeHidden();
	});

	await test.step("A lock from the timeline stays named, with the keys for spans", async () => {
		await viewer.steps.spanById(first).click();
		await page.mouse.move(0, 0);
		await expectShown("1/3", "First");
		await expect(viewer.root.locator('[data-span-focused="true"]')).toHaveCount(
			1,
		);
	});
});

test("the step ruler takes keyboard focus from the controls", async ({
	page,
	request,
}) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const { traceId } = await createParallelStepsTrace(request);
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	const { stepViewer, ruler } = viewer;
	await expect(stepViewer.screenshot).toBeVisible({ timeout: 10000 });

	await test.step("Space plays after a seek, not the button pressed before it", async () => {
		await stepViewer.nextButton.click();
		await ruler.clickAt(0.3);
		await expect(stepViewer.position).toHaveText("1/3");
		await expect(stepViewer.root).toBeFocused();
		await page.keyboard.press("Space");
		await expect(stepViewer.pauseButton).toBeVisible();
		await expect(stepViewer.position).toHaveText("1/3");
		await page.keyboard.press("Space");
		await page.keyboard.press("Escape");
	});

	await test.step("From before the first step, Right goes to the first step", async () => {
		await ruler.clickAt(0.1);
		await expect(stepViewer.position).toHaveText("–/3");
		await page.keyboard.press("ArrowRight");
		await expect(stepViewer.position).toHaveText("1/3");
		await expect(stepViewer.stepTitle).toHaveText("First");
		await page.keyboard.press("Escape");
	});

	await test.step("That holds with focus out of the viewer too", async () => {
		await ruler.clickAt(0.1);
		await stepViewer.root.blur();
		await page.keyboard.press("ArrowRight");
		await expect(stepViewer.position).toHaveText("1/3");
	});
});

test("steps through each test body step, showing it once it has finished", async ({
	page,
	request,
}) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();

	const builder = new TraceDataBuilder(traceId, testStartTime).addTestSpan(
		"Step viewer",
		4000,
	);
	const beforeHooks = builder.addStepSpanAndGetId("Before Hooks", 500, {
		startOffsetMs: 0,
	});
	builder.addStepSpanAndGetId("Navigate in beforeEach", 400, {
		startOffsetMs: 0,
		parentSpanId: beforeHooks,
	});
	const login = builder.addStepSpanAndGetId("Login", 1200, {
		startOffsetMs: 600,
	});
	const fill = builder.addStepSpanAndGetId("Fill username", 300, {
		startOffsetMs: 600,
		parentSpanId: login,
	});
	const click = builder.addStepSpanAndGetId("Click", 500, {
		startOffsetMs: 1000,
		parentSpanId: login,
		attributes: {
			"test.step.category": "pw:api",
			"test.step.subtitle": "getByRole('button', { name: 'Log in' })",
		},
	});
	const check = builder.addStepSpanAndGetId("Check dashboard", 500, {
		startOffsetMs: 2000,
	});
	builder.addStepSpanAndGetId("After Hooks", 400, { startOffsetMs: 3500 });
	await builder.send(request);

	const screenshotsZip = await createScreenshotsZipFromOffsets({
		testStartTime,
		// Frames land after each step settles: fill ends at 900, click at 1500
		// and check at 2500, and the after hooks start at 3500.
		screenshotOffsetsMs: [100, 700, 950, 1600, 2600, 3600],
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
	const focusRing = viewer.root.locator('[data-span-focused="true"]');
	const lockedLine = viewer.root.locator("[data-locked-time-line]");

	const expectStop = async (
		position: string,
		stepId: string,
		screenshotOffsetMs: number,
	) => {
		await expect(stepViewer.position).toHaveText(position);
		await expect(stepViewer.position).toHaveAttribute("data-active", "true");
		// The step's details card is focused like any selected span, with no
		// step counter of its own.
		await expect(viewer.details.focusedCards).toHaveAttribute(
			"data-span-id",
			stepId,
		);
		await expect(viewer.details.root.getByText(/^Step \d+\/\d+$/)).toHaveCount(
			0,
		);
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			String(testStartTime + screenshotOffsetMs),
		);
		// The counter marks the stop; the focus ring is for span navigation.
		await expect(focusRing).toHaveCount(0);
		await expect(stepViewer.step).toHaveAttribute("data-span-id", stepId);
	};
	/**
	 * The step named in the control bar, on one line; its tooltip names it in
	 * full with its parents.
	 */
	const expectStepCaption = async (
		title: string,
		subtitle: string | null,
		parents: string | null,
	) => {
		await expect(stepViewer.stepTitle).toHaveText(title);
		if (subtitle === null) await expect(stepViewer.stepSubtitle).toBeHidden();
		else await expect(stepViewer.stepSubtitle).toHaveText(subtitle);
		await expect(stepViewer.step).toHaveAttribute(
			"title",
			[parents, title, subtitle].filter(Boolean).join("\n"),
		);
	};
	const expectNoStepShown = async () => {
		await expect(stepViewer.position).toHaveText("–/3");
		await expect(stepViewer.position).not.toHaveAttribute("data-active");
		await expect(stepViewer.step).toBeHidden();
	};

	/** The first step's bar width as a share of the timeline plot. */
	const focusedStepShare = async () => {
		const bar = await viewer.steps.spanById(fill).boundingBox();
		const plot = await page.locator("[data-timeline-plot]").boundingBox();
		return bar && plot ? bar.width / plot.width : 0;
	};

	await test.step("Loading selects nothing and shows the first screenshot", async () => {
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			String(testStartTime + 100),
		);
		await expectNoStepShown();
		await expect(lockedLine).toHaveCount(0);
		// One page took every screenshot, so there is nothing to pick.
		await expect(stepViewer.pagePicker).toBeHidden();
	});

	await test.step("The step arrows show without hovering the viewer", async () => {
		await page.mouse.move(0, 0);
		await expect(stepViewer.nextButton).toHaveCSS("opacity", "1");
		await expect(stepViewer.previousButton).toHaveCSS("opacity", "1");
	});

	await test.step("The first arrow press goes to the first step", async () => {
		await page.keyboard.press("ArrowRight");
		// Shown just before the next step starts, once the page has settled.
		await expectStop("1/3", fill, 950);
		await expectStepCaption("Fill username", null, "Login");
		// Stepping keeps the zoom: the whole test stays in view, where the step
		// is 300 of 4000ms, with the step and the moment after it both shown.
		await expect.poll(focusedStepShare).toBeGreaterThan(0.06);
		await expect.poll(focusedStepShare).toBeLessThan(0.09);
		const plot = (await page.locator("[data-timeline-plot]").boundingBox())!;
		const line = (await lockedLine.boundingBox())!;
		expect(line.x).toBeGreaterThan(plot.x);
		expect(line.x).toBeLessThan(plot.x + plot.width);
		await expect(stepViewer.previousButton).toBeDisabled();
	});

	await test.step("Arrow keys move from step to step", async () => {
		await page.keyboard.press("ArrowRight");
		await expectStop("2/3", click, 1600);
		// The locator the step acted on is shown in full below its title.
		await expectStepCaption(
			"Click",
			"getByRole('button', { name: 'Log in' })",
			"Login",
		);
		// The last step settles until the after hooks start.
		await page.keyboard.press("ArrowRight");
		await expectStop("3/3", check, 2600);
		await expectStepCaption("Check dashboard", null, null);
		await expect(stepViewer.nextButton).toBeDisabled();
		await page.keyboard.press("ArrowRight");
		await expect(stepViewer.position).toHaveText("3/3");
		await page.keyboard.press("ArrowLeft");
		await expectStop("2/3", click, 1600);
		await page.keyboard.press("Home");
		await expectStop("1/3", fill, 950);
		await page.keyboard.press("End");
		await expectStop("3/3", check, 2600);
	});

	await test.step("The ruler draws each step, filled up to the playhead", async () => {
		const { ruler } = viewer;
		await expect(ruler.steps).toHaveCount(3);
		// Over the time each ran, of 4000ms: fill 600-900, click 1000-1500
		// and check 2000-2500.
		expect(await ruler.ratioOf(ruler.steps.nth(0))).toBeCloseTo(0.1875, 2);
		expect(await ruler.ratioOf(ruler.steps.nth(1))).toBeCloseTo(0.3125, 2);
		expect(await ruler.ratioOf(ruler.steps.nth(2))).toBeCloseTo(0.5625, 2);
		// The hooks are hatched at either end.
		await expect(ruler.hooks).toHaveCount(2);
		// On the last stop it stands out, and the bar is filled up to there.
		await expect(ruler.highlightedSteps).toHaveAttribute("data-span-id", check);
		await expect(ruler.playhead).toHaveAttribute("data-time-ms", "3499");
		await expect.poll(() => ruler.filledRatio()).toBeCloseTo(3499 / 4000, 2);
		// The playhead carries on down as the locked line, in the same place
		// once the line has moved there.
		await expect
			.poll(async () => {
				const knob = (await ruler.playhead.boundingBox())!;
				const line = (await lockedLine.boundingBox())!;
				return Math.abs(knob.x - line.x);
			})
			.toBeLessThan(2);
	});

	await test.step("Clicking a step on the ruler locks the time clicked, not the step's end", async () => {
		// The middle of fill, 750 of 4000ms.
		await viewer.ruler.clickAt(0.1875);
		await expect(viewer.ruler.playhead).toHaveAttribute(
			"data-time-ms",
			/^7[45]\d(\.\d+)?$/,
		);
		await expect(stepViewer.position).toHaveText("1/3");
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			String(testStartTime + 700),
		);
		await expect(viewer.ruler.highlightedSteps).toHaveAttribute(
			"data-span-id",
			fill,
		);
		await expect.poll(() => viewer.ruler.filledRatio()).toBeCloseTo(0.1875, 2);
	});

	await test.step("Clicking the time ticks locks the time too", async () => {
		// Below the step bar, in the middle of click: 1250ms.
		const rulerBox = (await viewer.ruler.root.boundingBox())!;
		const { x } = await viewer.ruler.pointAt(0.3125);
		await page.mouse.click(x, rulerBox.y + rulerBox.height - 8);
		await expect(viewer.ruler.playhead).toHaveAttribute(
			"data-time-ms",
			/^12[45]\d(\.\d+)?$/,
		);
		await expect(stepViewer.position).toHaveText("2/3");
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			String(testStartTime + 950),
		);
		await page.keyboard.press("End");
	});

	await test.step("Clicking the hooks on the ruler seeks there", async () => {
		await viewer.ruler.clickAt(0.05);
		await expect(viewer.ruler.playhead).toHaveAttribute(
			"data-time-ms",
			/^(19\d|20\d)(\.\d+)?$/,
		);
		await expect(stepViewer.position).toHaveText("–/3");
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			String(testStartTime + 100),
		);
		await expect(viewer.ruler.highlightedSteps).toHaveCount(0);
	});

	await test.step("Dragging along the ruler scrubs, naming the step there", async () => {
		const from = await viewer.ruler.pointAt(0.05);
		const to = await viewer.ruler.pointAt(0.45);
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(to.x, to.y, { steps: 6 });
		await page.mouse.up();
		// 1800ms: the click step's result is on screen.
		await expect(stepViewer.position).toHaveText("2/3");
		await expect(stepViewer.position).toHaveAttribute("data-active", "true");
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			String(testStartTime + 1600),
		);
		await expect(viewer.ruler.highlightedSteps).toHaveAttribute(
			"data-span-id",
			click,
		);
		// Stepping moves on from the step the counter shows.
		await page.keyboard.press("ArrowRight");
		await expectStop("3/3", check, 2600);
	});

	await test.step("The arrow buttons step too", async () => {
		await stepViewer.previousButton.click();
		await expectStop("2/3", click, 1600);
	});

	await test.step("Leaving the stops for span navigation shows the focus ring", async () => {
		await page.keyboard.press("Home");
		await page.keyboard.press("ArrowUp");
		await expect(focusRing).toHaveAttribute("data-span-id", login);
	});

	await test.step("With nothing selected, Left also goes to the first step", async () => {
		await page.keyboard.press("Escape");
		await expectNoStepShown();
		await expect(focusRing).toHaveCount(0);
		await page.keyboard.press("ArrowLeft");
		await expectStop("1/3", fill, 950);
	});

	await test.step("Clicking the counter or the viewer selects the first stop", async () => {
		await page.keyboard.press("Escape");
		await stepViewer.position.click();
		await expectStop("1/3", fill, 950);
		await page.keyboard.press("Escape");
		await stepViewer.screen.click();
		await expectStop("1/3", fill, 950);
	});

	await test.step("The step viewer can be hidden from settings", async () => {
		await viewer.settingsButton.click();
		await page.getByRole("menuitemcheckbox", { name: "Step viewer" }).click();
		await expect(stepViewer.root).toBeHidden();
		await page.keyboard.press("Escape");

		await page.reload();
		await viewer.loadTraceFromApi(traceId);
		await expect(viewer.header.root).toBeVisible();
		await expect(viewer.timelineRuler).toBeVisible();
		await expect(stepViewer.root).toBeHidden();
	});
});

/** Uploads screenshots taken at offsets from the test start, on given pages. */
async function uploadScreenshots(
	request: APIRequestContext,
	traceId: string,
	testStartTime: number,
	screenshotOffsetsMs: Parameters<
		typeof createScreenshotsZipFromOffsets
	>[0]["screenshotOffsetsMs"],
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

test("with several pages, a page can be pinned in the step viewer", async ({
	page,
	request,
}) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();
	const builder = new TraceDataBuilder(traceId, testStartTime).addTestSpan(
		"Two tabs",
		2000,
	);
	builder.addStepSpanAndGetId("Open shop", 400, { startOffsetMs: 100 });
	builder.addStepSpanAndGetId("Open help tab", 400, { startOffsetMs: 600 });
	builder.addStepSpanAndGetId("Back to shop", 300, { startOffsetMs: 1200 });
	await builder.send(request);
	await uploadScreenshots(request, traceId, testStartTime, [
		{ offsetMs: 50, pageId: "shop" },
		{ offsetMs: 650, pageId: "help" },
		{ offsetMs: 1250, pageId: "shop" },
	]);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	const { stepViewer } = viewer;
	const expectShown = async (pageId: string, offsetMs: number) => {
		await expect(stepViewer.screenshot).toHaveAttribute("data-page-id", pageId);
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			String(testStartTime + offsetMs),
		);
	};

	await test.step("Each page gets a thumbnail in the control bar; the one shown is ringed", async () => {
		await expect(stepViewer.position).toHaveText("–/3");
		await page.keyboard.press("ArrowRight");
		await expect(stepViewer.position).toHaveText("1/3");
		await expect(stepViewer.pagePicker.getByRole("button")).toHaveCount(2);
		const bar = (await stepViewer.controlBar.boundingBox())!;
		const picker = (await stepViewer.pagePicker.boundingBox())!;
		expect(picker.y).toBeGreaterThanOrEqual(bar.y);
		expect(picker.y + picker.height).toBeLessThanOrEqual(bar.y + bar.height);
		expect(picker.x + picker.width).toBeGreaterThan(bar.x + bar.width * 0.8);
		await expect(stepViewer.page(1)).toHaveClass(/ring-blue-600/);
		await expect(stepViewer.page(1)).toHaveCSS("opacity", "1");
		await expect(stepViewer.page(2)).toHaveCSS("opacity", "0.5");
	});

	await test.step("Unpinned, the viewer shows whichever page drew last", async () => {
		await page.keyboard.press("ArrowRight");
		await expect(stepViewer.position).toHaveText("2/3");
		await expectShown("help", 650);
		await expect(stepViewer.page(2)).toHaveClass(/ring-blue-600/);
		await expect(stepViewer.page(1)).toHaveCSS("opacity", "0.5");
	});

	await test.step("A pinned page stays on screen while stepping", async () => {
		await stepViewer.page(1).click();
		await expect(stepViewer.page(1)).toHaveAttribute("aria-pressed", "true");
		await expectShown("shop", 50);
		await page.keyboard.press("ArrowRight");
		await expectShown("shop", 1250);
		await page.keyboard.press("ArrowLeft");
		await expect(stepViewer.position).toHaveText("2/3");
		await expectShown("shop", 50);
	});

	await test.step("Clicking the pinned page follows the latest page again", async () => {
		await stepViewer.page(1).click();
		await expect(stepViewer.page(1)).toHaveAttribute("aria-pressed", "false");
		await expectShown("help", 650);
	});
});

test("a search result takes over from the step viewer and goes to the span", async ({
	page,
	request,
}) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();
	const builder = new TraceDataBuilder(traceId, testStartTime).addTestSpan(
		"Search from a stop",
		6000,
	);
	builder.addStepSpanAndGetId("Open the page", 300, { startOffsetMs: 100 });
	const save = builder.addStepSpanAndGetId("Save the form", 2000, {
		startOffsetMs: 1000,
	});
	await builder.send(request);
	await uploadScreenshots(request, traceId, testStartTime, [50, 1100]);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	const { stepViewer, search } = viewer;
	const focusRing = viewer.root.locator('[data-span-focused="true"]');
	const saveShare = async () => {
		const bar = await viewer.steps.spanById(save).boundingBox();
		const plot = await page.locator("[data-timeline-plot]").boundingBox();
		return bar && plot ? bar.width / plot.width : 0;
	};
	const selectSaveFromSearch = async () => {
		await search.input.click();
		await expect(search.resultItems.first()).toBeVisible();
		await search.resultItems
			.filter({ hasText: "Save the form" })
			.first()
			.click();
	};

	await test.step("Selecting a result leaves the stop and zooms to the span", async () => {
		await expect(stepViewer.position).toHaveText("–/2");
		await page.keyboard.press("ArrowRight");
		await expect(stepViewer.position).toHaveText("1/2");
		await search.input.fill("Save the form");
		await expect(search.resultItems.first()).toBeVisible();
		await search.resultItems
			.filter({ hasText: "Save the form" })
			.first()
			.click();
		await expect(focusRing).toHaveAttribute("data-span-id", save);
		// Zoomed to fit: the span fills about 60% of the plot.
		await expect.poll(saveShare).toBeGreaterThan(0.5);
		await expect.poll(saveShare).toBeLessThan(0.7);
	});

	await test.step("The same result can be picked again after stepping away", async () => {
		// Selecting blurs the search, so the arrow keys work straight away.
		await page.keyboard.press("Escape");
		await page.keyboard.press("ArrowRight");
		await expect(stepViewer.position).toHaveText("1/2");
		await selectSaveFromSearch();
		await expect(focusRing).toHaveAttribute("data-span-id", save);
	});
});
