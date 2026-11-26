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

/** The page the screenshots are of; they're taken at half its size. */
const VIEWPORT = { width: 1280, height: 720 };
const SAVE = { x: 600, y: 340, width: 80, height: 40 };
const NAME = { x: 100, y: 100, width: 200, height: 40 };

/** One recorded action, at offsets from the test's start. */
interface Action {
	method: string;
	atMs: number;
	/** The first and last frame that show it in place */
	framesMs: [number, number];
	point?: { x: number; y: number };
	box?: typeof SAVE;
	failed?: true;
}

/**
 * A run that clicks, fills, clicks something that doesn't work, then checks
 * the result. The page takes a frame of what the click and the fill did while
 * their elements are still being watched, at 1300 and 2300 ms; none of the
 * click that fails; and one as the last step ends, at 3480 ms, by when the
 * page has moved on.
 */
async function createRun(
	request: APIRequestContext,
	options: {
		testStartTime?: number;
		viewport?: typeof VIEWPORT | null;
		actions?: Action[];
	} = {},
) {
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = options.testStartTime ?? Date.now();
	const builder = new TraceDataBuilder(traceId, testStartTime).addTestSpan(
		"Saves a name",
		4000,
	);
	builder.addStepSpanAndGetId("Before Hooks", 500, { startOffsetMs: 0 });
	const step = (title: string, startOffsetMs: number, category = "pw:api") =>
		builder.addStepSpanAndGetId(title, 100, {
			startOffsetMs,
			attributes: {
				"test.step.category": category,
				"code.line.number": startOffsetMs / 100,
			},
		});
	step("Click", 1000);
	step("Fill", 2000);
	step("Click", 3000);
	step('Expect "toBeVisible"', 3400, "expect");
	builder.addStepSpanAndGetId("After Hooks", 300, { startOffsetMs: 3700 });
	await builder.send(request);

	const actions = options.actions ?? [
		{
			method: "click",
			atMs: 1010,
			framesMs: [900, 1300],
			point: { x: 640, y: 360 },
			box: SAVE,
		},
		{ method: "fill", atMs: 2010, framesMs: [2300, 2300], box: NAME },
		// Shown on the frame from before it: nothing changed in between.
		{
			method: "click",
			atMs: 3010,
			framesMs: [2300, 2300],
			point: { x: 640, y: 360 },
			box: SAVE,
			failed: true,
		},
	];
	const zip = await createScreenshotsZipFromOffsets({
		testStartTime,
		screenshotOffsetsMs: [100, 900, 1300, 2300, 3480],
		pageId: "page-0",
		...(options.viewport === null
			? {}
			: { viewport: options.viewport ?? VIEWPORT }),
		actions: actions.map((action) => ({
			pageId: "page-0",
			time: testStartTime + action.atMs,
			frames: {
				from: testStartTime + action.framesMs[0],
				until: testStartTime + action.framesMs[1],
			},
			method: action.method,
			...(action.point ? { point: action.point } : {}),
			...(action.box ? { box: action.box } : {}),
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
		/** The timestamp of the frame taken this far into the test */
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

test("marks what each step did on the screenshot that shows it", async ({
	page,
	request,
}) => {
	const { traceId, frameAt } = await createRun(request);
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	const { stepViewer } = viewer;
	const overlay = stepViewer.screen.getByTestId("action-overlay");
	/** Waits for a step's own frame: the mark goes by the frame on screen. */
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
		await expectFrame(1300);
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

	await test.step("A fill: only its element", async () => {
		await stepViewer.nextButton.click();
		await expect(stepViewer.position).toHaveText("2/4");
		await expectFrame(2300);
		await expect(overlay).toHaveAttribute("data-method", "fill");
		await expect(point).toHaveCount(0);
		expectNear(await placeOnPage(stepViewer.screenshot, box), NAME);
	});

	await test.step("An action that failed is marked as failed, on the frame it found", async () => {
		await stepViewer.nextButton.click();
		await expect(stepViewer.position).toHaveText("3/4");
		await expectFrame(2300);
		await expect(overlay).toHaveAttribute("data-method", "click");
		await expect(overlay).toHaveAttribute("data-failed", "");
	});

	await test.step("A frame from after the element was last seen there has no mark", async () => {
		await stepViewer.nextButton.click();
		await expect(stepViewer.position).toHaveText("4/4");
		await expectFrame(3480);
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
				atMs: 1010,
				framesMs: [900, 1300],
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
