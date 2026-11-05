import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { createScreenshotsZipFromOffsets } from "./screenshot-zip";
import { TraceDataBuilder } from "./test-data-builder";

const SHOP_OFFSETS_MS = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500];
const HELP_OFFSETS_MS = [700, 1700, 2700];

/** A 4s test on two pages: a shop, and a help tab opened partway. */
async function createTrace(
	request: APIRequestContext,
): Promise<{ traceId: string; testStartTime: number }> {
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();
	const builder = new TraceDataBuilder(traceId, testStartTime).addTestSpan(
		"Player filmstrip",
		4000,
	);
	builder.addStepSpanAndGetId("Open shop", 400, { startOffsetMs: 100 });
	builder.addStepSpanAndGetId("Open help", 400, {
		startOffsetMs: 600,
		attributes: { "test.step.subtitle": "help.example" },
	});
	builder.addStepSpanAndGetId("Back to shop", 300, { startOffsetMs: 1200 });
	await builder.send(request);

	const zip = await createScreenshotsZipFromOffsets({
		testStartTime,
		screenshotOffsetsMs: [
			...SHOP_OFFSETS_MS.map((offsetMs) => ({ offsetMs, pageId: "shop" })),
			...HELP_OFFSETS_MS.map((offsetMs) => ({ offsetMs, pageId: "help" })),
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
	return { traceId, testStartTime };
}

function frameAt(testStartTime: number, offsetsMs: number[], timeMs: number) {
	const offset = offsetsMs.filter((offsetMs) => offsetMs <= timeMs).at(-1);
	if (offset === undefined) throw new Error(`No frame at ${timeMs}ms`);
	return String(testStartTime + offset);
}

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
});

test("the player's height follows its screen, keeping sizes dragged to", async ({
	page,
	request,
}) => {
	const { traceId } = await createTrace(request);
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	const { stepViewer } = viewer;
	await expect(stepViewer.screenshot).toBeVisible({ timeout: 10000 });
	const playerHeight = async () =>
		(await stepViewer.root.boundingBox())?.height ?? 0;
	const separator = page
		.getByRole("separator")
		.and(page.locator('[aria-orientation="horizontal"]'));

	const bigScreenHeight = await playerHeight();

	await test.step("The filmstrip takes less height, and its rows fill it", async () => {
		await viewer.settings.chooseScreen("Filmstrip");
		await expect.poll(playerHeight).toBeLessThan(bigScreenHeight - 40);
		const screen = (await stepViewer.filmstrip.root.boundingBox())!;
		const rows = await stepViewer.filmstrip.rows().all();
		const rowHeights = await Promise.all(
			rows.map(async (row) => (await row.boundingBox())!.height),
		);
		const used = rowHeights.reduce((total, height) => total + height, 0);
		expect(used).toBeGreaterThan(screen.height * 0.8);
	});

	await test.step("Rows grow with a player dragged taller", async () => {
		const box = (await separator.first().boundingBox())!;
		const rowHeight = async () =>
			(await stepViewer.filmstrip.rows().first().boundingBox())?.height ?? 0;
		const before = await rowHeight();
		await page.mouse.move(box.x + box.width / 2, box.y + 1);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, box.y + 200, { steps: 4 });
		await page.mouse.up();
		await expect.poll(rowHeight).toBeGreaterThan(before + 60);
	});

	await test.step("Each screen keeps its own height", async () => {
		const filmstripHeight = await playerHeight();
		await viewer.settings.chooseScreen("Big screen");
		await expect.poll(playerHeight).toBeCloseTo(bigScreenHeight, 0);
		await viewer.settings.chooseScreen("Filmstrip");
		await expect.poll(playerHeight).toBeCloseTo(filmstripHeight, 0);
	});
});

test("the step viewer can show a filmstrip of every page instead of the big screen", async ({
	page,
	request,
}) => {
	const { traceId, testStartTime } = await createTrace(request);
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	const { stepViewer, ruler } = viewer;
	const { filmstrip } = stepViewer;
	await expect(stepViewer.screenshot).toBeVisible({ timeout: 10000 });

	await test.step("The big screen is the default, with a page picker", async () => {
		await expect(filmstrip.root).toHaveCount(0);
		await expect(stepViewer.pagePicker).toBeVisible();
		await viewer.settings.open();
		await expect(viewer.settings.screen("Big screen")).toBeChecked();
		await viewer.settings.close();
	});

	await test.step("Choosing the filmstrip shows a row per page in its place", async () => {
		await viewer.settings.chooseScreen("Filmstrip");
		await expect(filmstrip.root).toBeVisible();
		await expect(stepViewer.screenshot).toHaveCount(0);
		await expect(filmstrip.rows()).toHaveCount(2);
		// Every page has a row, so there is no page to pick.
		await expect(stepViewer.pagePicker).toBeHidden();
		await expect(stepViewer.controlBar).toBeVisible();
		await expect(ruler.root).toBeVisible();
	});

	await test.step("The rows line up with the span panels", async () => {
		const plot = (await page.locator("[data-timeline-plot]").boundingBox())!;
		const row = (await filmstrip.row("shop").boundingBox())!;
		expect(row.x).toBeCloseTo(plot.x, 0);
		expect(row.width).toBeCloseTo(plot.width, 0);
	});

	await test.step("Hovering a frame zooms it below the player, named with its step", async () => {
		const row = (await filmstrip.row("shop").boundingBox())!;
		// 800ms of 4000ms: while the help tab is being opened.
		await page.mouse.move(row.x + row.width * 0.2, row.y + row.height / 2);
		await expect(filmstrip.zoom).toBeVisible();
		await expect(filmstrip.zoom).toHaveAttribute(
			"data-screenshot-page-id",
			"shop",
		);
		await expect(filmstrip.zoom).toHaveAttribute(
			"data-screenshot-timestamp",
			frameAt(testStartTime, SHOP_OFFSETS_MS, 800),
		);
		await expect(filmstrip.zoomCaption).toHaveText(
			/^2\. Open help help\.example · \d+ms$/,
		);
		const zoomBox = (await filmstrip.zoom.boundingBox())!;
		const spans = (await viewer.timelineContent.boundingBox())!;
		expect(zoomBox.y).toBeGreaterThanOrEqual(spans.y);

		// The other page's row zooms that page.
		const help = (await filmstrip.row("help").boundingBox())!;
		await page.mouse.move(help.x + help.width * 0.6, help.y + help.height / 2);
		await expect(filmstrip.zoom).toHaveAttribute(
			"data-screenshot-page-id",
			"help",
		);
		await expect(filmstrip.zoom).toHaveAttribute(
			"data-screenshot-timestamp",
			frameAt(testStartTime, HELP_OFFSETS_MS, 2400),
		);

		await stepViewer.controlBar.hover();
		await expect(filmstrip.zoom).toHaveCount(0);
	});

	await test.step("Clicking a frame locks that exact time", async () => {
		const row = (await filmstrip.row("shop").boundingBox())!;
		// 1280ms, during "Back to shop".
		await page.mouse.click(row.x + row.width * 0.32, row.y + row.height / 2);
		await expect(ruler.playhead).toHaveAttribute(
			"data-time-ms",
			/^12[5-9]\d(\.\d+)?$/,
		);
		await expect(stepViewer.position).toHaveText("3/3");
	});

	await test.step("Hovering the ruler doesn't open its own filmstrip", async () => {
		await ruler.hoverAt(0.5);
		await expect(ruler.filmstrip.root).toHaveCount(0);
	});

	await test.step("The frames follow the zoom of the span panels", async () => {
		const firstShopFrame = filmstrip
			.row("shop")
			.locator("img[data-screenshot-timestamp]")
			.first();
		await expect(firstShopFrame).toHaveAttribute(
			"data-screenshot-timestamp",
			String(testStartTime),
		);
		await viewer.zoomTimelineToRange(0.5, 0.98);
		await expect
			.poll(async () =>
				Number(await firstShopFrame.getAttribute("data-screenshot-timestamp")),
			)
			.toBeGreaterThanOrEqual(testStartTime + 1500);
	});

	await test.step("The choice is remembered", async () => {
		await page.reload();
		await viewer.loadTraceFromApi(traceId);
		await expect(filmstrip.root).toBeVisible({ timeout: 10000 });
		await viewer.settings.open();
		await expect(viewer.settings.screen("Filmstrip")).toBeChecked();
		await viewer.settings.close();
	});
});

test("with no span panels below the player, hovering a frame doesn't zoom", async ({
	page,
	request,
}) => {
	const { traceId } = await createTrace(request);
	const viewer = new TraceViewerPage(page);
	await viewer.useViewerSettings({
		playerScreen: "filmstrip",
		steps: false,
		browser: false,
		external: false,
	});
	await viewer.loadTraceFromApi(traceId);
	const { filmstrip } = viewer.stepViewer;
	await expect(filmstrip.rows()).toHaveCount(2, { timeout: 10000 });

	const row = (await filmstrip.row("shop").boundingBox())!;
	await page.mouse.move(row.x + row.width * 0.5, row.y + row.height / 2);
	await expect(
		filmstrip.row("shop").locator("[data-under-pointer]"),
	).toHaveCount(1);
	await expect(filmstrip.zoom).toHaveCount(0);
});
