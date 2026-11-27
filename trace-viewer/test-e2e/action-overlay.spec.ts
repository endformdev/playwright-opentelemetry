import { randomUUID } from "node:crypto";
import {
	type APIRequestContext,
	expect,
	type Locator,
	test,
} from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { createScreenshotsZipFromOffsets } from "./screenshot-zip";
import { TraceDataBuilder } from "./test-data-builder";

const VIEWPORT = { width: 1280, height: 720 };
const SAVE = { x: 540, y: 310, width: 200, height: 100 };
const NAME = { x: 200, y: 120, width: 320, height: 60 };

interface RunAction {
	method: string;
	startMs: number;
	endMs: number;
	point?: { x: number; y: number };
	box?: { x: number; y: number; width: number; height: number };
	dragFrom?: { x: number; y: number };
	failed?: true;
}

async function createRun(
	request: APIRequestContext,
	options: {
		testStartTime?: number;
		viewport?: { width: number; height: number } | null;
		actions?: RunAction[];
	} = {},
) {
	const traceId = randomUUID().replace(/-/g, "");
	const testStartTime = options.testStartTime ?? Date.now();
	const builder = new TraceDataBuilder(traceId, testStartTime);
	builder.addTestSpan("action overlay test", 5000);
	builder.addStepSpanAndGetId("Before Hooks", 500, { startOffsetMs: 0 });
	const step = (title: string, startOffsetMs: number, category = "pw:api") =>
		builder.addStepSpanAndGetId(title, 100, {
			startOffsetMs,
			attributes: {
				"test.step.category": category,
				"code.line.number": startOffsetMs / 100,
			},
		});
	// Stops sit 1ms before the next step:
	//   1/4 @ 1149ms (59ms after click -> both box and point visible)
	//   2/4 @ 1499ms (259ms after fill -> fill box visible)
	//   3/4 @ 1799ms (209ms after failed click -> failed box + cross visible)
	//   4/4 @ 2499ms (909ms after failed click -> past 750ms hold, no mark)
	step("Click", 1000);
	step("Fill", 1150);
	step("Click", 1500);
	step('Expect "toBeVisible"', 1800, "expect");
	builder.addStepSpanAndGetId("After Hooks", 300, { startOffsetMs: 2500 });
	await builder.send(request);

	const actions: RunAction[] = options.actions ?? [
		{
			method: "click",
			startMs: 1010,
			endMs: 1090,
			point: { x: 640, y: 360 },
			box: SAVE,
		},
		{ method: "fill", startMs: 1160, endMs: 1240, box: NAME },
		{
			method: "click",
			startMs: 1510,
			endMs: 1590,
			point: { x: 640, y: 360 },
			box: SAVE,
			failed: true,
		},
	];
	const zip = await createScreenshotsZipFromOffsets({
		testStartTime,
		screenshotOffsetsMs: [100, 900, 1100, 1400, 1700, 2300],
		pageId: "page-0",
		...(options.viewport === null
			? {}
			: { viewport: options.viewport ?? VIEWPORT }),
		actions: actions.map((action) => ({
			pageId: "page-0",
			start: testStartTime + action.startMs,
			end: testStartTime + action.endMs,
			method: action.method,
			...(action.point ? { point: action.point } : {}),
			...(action.box ? { box: action.box } : {}),
			...(action.dragFrom ? { dragFrom: action.dragFrom } : {}),
			...(action.failed ? { failed: true } : {}),
		})),
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
		frameAt: (offsetMs: number) => String(testStartTime + offsetMs),
	};
}

/**
 * Where a part of the overlay is drawn, in the page's own pixels: its place
 * on the image, scaled back up by how much smaller the image is shown.
 */
async function placeOnPage(image: Locator, part: Locator) {
	const shown = await image.boundingBox();
	const drawn = await part.boundingBox();
	if (!shown || !drawn) throw new Error("Nothing is drawn");
	// The image fills its box's height here, and is centred across it.
	const scale = VIEWPORT.height / shown.height;
	const left = shown.x + (shown.width - VIEWPORT.width / scale) / 2;
	return {
		x: (drawn.x - left) * scale,
		y: (drawn.y - shown.y) * scale,
		width: drawn.width * scale,
		height: drawn.height * scale,
	};
}

function expectNear(place: typeof SAVE, want: typeof SAVE) {
	// Strokes are a couple of screen pixels wide, more in the page's own.
	const tolerance = 8;
	for (const key of ["x", "y", "width", "height"] as const) {
		expect(
			Math.abs(place[key] - want[key]),
			`${key} is ${place[key]}, wanted ${want[key]}`,
		).toBeLessThanOrEqual(tolerance);
	}
}

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
});

test("marks what each step did and fades marks out after the action", async ({
	page,
	request,
}) => {
	const { traceId, frameAt } = await createRun(request);
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	const { stepViewer } = viewer;
	const overlay = stepViewer.screen.getByTestId("action-overlay");
	const expectFrame = (offsetMs: number) =>
		expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			frameAt(offsetMs),
		);
	const box = overlay.getByTestId("action-overlay-box").locator("rect").last();
	const point = overlay.getByTestId("action-overlay-point");
	await page.mouse.move(0, 0);
	await stepViewer.root.press("Home");

	await test.step("A click: the point it landed on and its element", async () => {
		await expect(stepViewer.position).toHaveText("1/4");
		await expectFrame(1100);
		await expect(overlay).toHaveAttribute("data-method", "click");
		await expect(overlay).not.toHaveAttribute("data-failed");
		expectNear(await placeOnPage(stepViewer.screenshot, box), SAVE);
		const dot = await placeOnPage(
			stepViewer.screenshot,
			point.locator("circle").last(),
		);
		expect(Math.abs(dot.x + dot.width / 2 - 640)).toBeLessThanOrEqual(4);
		expect(Math.abs(dot.y + dot.height / 2 - 360)).toBeLessThanOrEqual(4);
	});

	await test.step("A fill: only its element, replacing the earlier click", async () => {
		await stepViewer.nextButton.click();
		await expect(stepViewer.position).toHaveText("2/4");
		await expectFrame(1400);
		await expect(overlay).toHaveAttribute("data-method", "fill");
		await expect(point).toHaveCount(0);
		expectNear(await placeOnPage(stepViewer.screenshot, box), NAME);
	});

	await test.step("A failed action is marked as failed", async () => {
		await stepViewer.nextButton.click();
		await expect(stepViewer.position).toHaveText("3/4");
		await expectFrame(1700);
		await expect(overlay).toHaveAttribute("data-method", "click");
		await expect(overlay).toHaveAttribute("data-failed", "");
	});

	await test.step("Later steps past the fade window show no mark", async () => {
		await stepViewer.nextButton.click();
		await expect(stepViewer.position).toHaveText("4/4");
		await expectFrame(2300);
		await expect(overlay).toHaveCount(0);
	});

	await test.step("The mark takes no clicks: the screen still plays and pauses", async () => {
		await stepViewer.previousButton.click();
		await expect(overlay).toBeVisible();
		const shown = await box.boundingBox();
		if (!shown) throw new Error("No box is drawn");
		await page.mouse.click(
			shown.x + shown.width / 2,
			shown.y + shown.height / 2,
		);
		await expect(stepViewer.pauseButton).toBeVisible();
		await stepViewer.pauseButton.click();
	});
});

test("draws nothing on screenshots that don't say how large the page was", async ({
	page,
	request,
}) => {
	const { traceId } = await createRun(request, { viewport: null });
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	const { stepViewer } = viewer;
	await page.mouse.move(0, 0);
	await stepViewer.root.press("Home");

	await expect(stepViewer.position).toHaveText("1/4");
	await expect(stepViewer.screenshot).toBeVisible();
	await expect(stepViewer.screen.getByTestId("action-overlay")).toHaveCount(0);
});

test("marks a comparison's own actions on its own screenshots", async ({
	page,
	request,
}) => {
	const now = Date.now();
	const primary = await createRun(request, { testStartTime: now });
	const elsewhere = { x: 1000, y: 600, width: 120, height: 60 };
	const comparison = await createRun(request, {
		testStartTime: now - 60 * 60 * 1000,
		actions: [
			{
				method: "hover",
				startMs: 1010,
				endMs: 1050,
				point: { x: 1060, y: 630 },
				box: elsewhere,
			},
		],
	});
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromUrlParam(primary.traceId, {
		compareSource: comparison.url,
		view: "player",
	});
	const { stepViewer } = viewer;
	await expect(stepViewer.comparisonScreenshot).toBeVisible();
	await page.mouse.move(0, 0);
	await stepViewer.root.press("Home");
	await expect(stepViewer.position).toHaveText("1/4");

	const primaryOverlay = page
		.getByTestId("step-viewer-primary")
		.getByTestId("action-overlay");
	const comparisonOverlay = stepViewer.comparison.getByTestId("action-overlay");
	await expect(primaryOverlay).toHaveAttribute("data-method", "click");
	await expect(comparisonOverlay).toHaveAttribute("data-method", "hover");
	expectNear(
		await placeOnPage(
			stepViewer.comparisonScreenshot,
			comparisonOverlay
				.getByTestId("action-overlay-box")
				.locator("rect")
				.last(),
		),
		elsewhere,
	);
});
