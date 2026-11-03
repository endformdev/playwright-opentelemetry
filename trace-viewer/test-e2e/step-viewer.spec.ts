import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { createScreenshotsZipFromOffsets } from "./screenshot-zip";
import { TraceDataBuilder } from "./test-data-builder";

test("steps through the start of each test body step, then the end", async ({
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
	const click = builder.addStepSpanAndGetId("Click login", 500, {
		startOffsetMs: 1000,
		parentSpanId: login,
	});
	const check = builder.addStepSpanAndGetId("Check dashboard", 500, {
		startOffsetMs: 2000,
	});
	builder.addStepSpanAndGetId("After Hooks", 400, { startOffsetMs: 3500 });
	await builder.send(request);

	const screenshotsZip = await createScreenshotsZipFromOffsets({
		testStartTime,
		screenshotOffsetsMs: [100, 700, 850, 1200, 3600],
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
		badge: string,
		stepId: string,
		screenshotOffsetMs: number,
	) => {
		await expect(stepViewer.position).toHaveText(position);
		await expect(stepViewer.position).toHaveAttribute("data-active", "true");
		// The step's details card says it is the viewer's stop.
		await expect(viewer.details.badges).toHaveText(badge);
		await expect(viewer.details.badge(stepId)).toBeVisible();
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			String(testStartTime + screenshotOffsetMs),
		);
		// The counter marks the stop; the focus ring is for span navigation.
		await expect(focusRing).toHaveCount(0);
	};
	const expectNotOnStop = async () => {
		await expect(stepViewer.position).toHaveText("–/4");
		await expect(stepViewer.position).not.toHaveAttribute("data-active");
		await expect(viewer.details.badges).toHaveCount(0);
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
		await expectNotOnStop();
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
		await expectStop("1/4", "Step 1/4", fill, 100);
		await expect.poll(focusedStepShare).toBeGreaterThan(0.14);
		await expect(stepViewer.previousButton).toBeDisabled();
	});

	await test.step("Arrow keys move from step start to step start, then to the end", async () => {
		await page.keyboard.press("ArrowRight");
		await expectStop("2/4", "Step 2/4", click, 850);
		await page.keyboard.press("ArrowRight");
		await expectStop("3/4", "Step 3/4", check, 1200);
		await page.keyboard.press("ArrowRight");
		await expectStop("4/4", "End of steps · 4/4", check, 1200);
		await expect(stepViewer.nextButton).toBeDisabled();
		await page.keyboard.press("ArrowRight");
		await expect(stepViewer.position).toHaveText("4/4");
		await page.keyboard.press("ArrowLeft");
		await expectStop("3/4", "Step 3/4", check, 1200);
		await page.keyboard.press("Home");
		await expectStop("1/4", "Step 1/4", fill, 100);
		await page.keyboard.press("End");
		await expectStop("4/4", "End of steps · 4/4", check, 1200);
	});

	await test.step("The arrow buttons step too", async () => {
		await stepViewer.previousButton.click();
		await expectStop("3/4", "Step 3/4", check, 1200);
	});

	await test.step("Leaving the stops for span navigation shows the focus ring", async () => {
		await page.keyboard.press("Home");
		await page.keyboard.press("ArrowUp");
		await expectNotOnStop();
		await expect(focusRing).toHaveAttribute("data-span-id", login);
	});

	await test.step("With nothing selected, Left also goes to the first step", async () => {
		await page.keyboard.press("Escape");
		await expectNotOnStop();
		await expect(focusRing).toHaveCount(0);
		await page.keyboard.press("ArrowLeft");
		await expectStop("1/4", "Step 1/4", fill, 100);
	});

	await test.step("Clicking the counter or the viewer selects the first stop", async () => {
		await page.keyboard.press("Escape");
		await stepViewer.position.click();
		await expectStop("1/4", "Step 1/4", fill, 100);
		await page.keyboard.press("Escape");
		await stepViewer.root.click();
		await expectStop("1/4", "Step 1/4", fill, 100);
	});

	await test.step("The step viewer can be hidden from settings", async () => {
		await viewer.settingsButton.click();
		await page.getByRole("menuitemcheckbox", { name: "Step viewer" }).click();
		await expect(stepViewer.root).toBeHidden();
		await page.keyboard.press("Escape");

		await page.reload();
		await viewer.loadTraceFromApi(traceId);
		await expect(viewer.header.root).toBeVisible();
		await expect(viewer.screenshots.root).toBeVisible();
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

	await test.step("Each page gets a thumbnail; pages with no frame yet are dimmed", async () => {
		await expect(stepViewer.position).toHaveText("–/4");
		await page.keyboard.press("ArrowRight");
		await expect(stepViewer.position).toHaveText("1/4");
		await expect(stepViewer.pagePicker.getByRole("button")).toHaveCount(2);
		await expect(stepViewer.page(1)).toHaveCSS("opacity", "1");
		await expect(stepViewer.page(2)).toHaveCSS("opacity", "0.4");
	});

	await test.step("Unpinned, the viewer shows whichever page drew last", async () => {
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("ArrowRight");
		await expect(stepViewer.position).toHaveText("3/4");
		await expectShown("help", 650);
	});

	await test.step("A pinned page stays on screen while stepping", async () => {
		await stepViewer.page(1).click();
		await expect(stepViewer.page(1)).toHaveAttribute("aria-pressed", "true");
		await expectShown("shop", 50);
		await page.keyboard.press("ArrowRight");
		await expectShown("shop", 1250);
		await page.keyboard.press("ArrowLeft");
		await expect(stepViewer.position).toHaveText("3/4");
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
		await expect(stepViewer.position).toHaveText("–/3");
		await page.keyboard.press("ArrowRight");
		await expect(stepViewer.position).toHaveText("1/3");
		await search.input.fill("Save the form");
		await expect(search.resultItems.first()).toBeVisible();
		await search.resultItems
			.filter({ hasText: "Save the form" })
			.first()
			.click();
		await expect(focusRing).toHaveAttribute("data-span-id", save);
		await expect(stepViewer.position).toHaveText("–/3");
		// Zoomed to fit: the span fills about 60% of the plot.
		await expect.poll(saveShare).toBeGreaterThan(0.5);
		await expect.poll(saveShare).toBeLessThan(0.7);
	});

	await test.step("The same result can be picked again after stepping away", async () => {
		// Selecting blurs the search, so the arrow keys work straight away.
		await page.keyboard.press("Escape");
		await page.keyboard.press("ArrowRight");
		await expect(stepViewer.position).toHaveText("1/3");
		await selectSaveFromSearch();
		await expect(focusRing).toHaveAttribute("data-span-id", save);
		await expect(stepViewer.position).toHaveText("–/3");
	});
});
