import { randomUUID } from "node:crypto";
import {
	type APIRequestContext,
	expect,
	type FrameLocator,
	type Page,
	test,
} from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import {
	createScreenshotsZip,
	createScreenshotsZipFromOffsets,
} from "./screenshot-zip";
import { SpanKind, TraceDataBuilder } from "./test-data-builder";

/**
 * A trace with a step and a browser span, and optionally screenshots: from
 * one page, or one frame from each of several pages.
 */
async function createTrace(
	request: APIRequestContext,
	options: { screenshots?: boolean; pages?: number; durationMs?: number } = {},
): Promise<string> {
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();
	await new TraceDataBuilder(traceId, testStartTime)
		.addTestSpan("Viewer panels", options.durationMs ?? 3000)
		.addStepSpan("Open the app", 400, { startOffsetMs: 100 })
		.addCustomSpan({
			serviceName: "playwright-browser",
			scopeName: "playwright-browser",
			name: "HTTP GET",
			kind: SpanKind.CLIENT,
			attributes: { "http.request.method": "GET" },
			startOffsetMs: 200,
			durationMs: 300,
		})
		.send(request);

	if (options.screenshots ?? true) {
		const pages = options.pages ?? 1;
		const screenshotsZip =
			pages > 1
				? await createScreenshotsZip({
						testStartTime,
						contextCount: 1,
						pagesPerContext: pages,
					})
				: await createScreenshotsZipFromOffsets({
						testStartTime,
						screenshotOffsetsMs: [0, 500, 1000, 1500, 2000, 2500],
					});
		const upload = await request.put(
			`${TRACE_API_URL}/playwright-otel-reporter/v1/screenshots.zip`,
			{
				data: Buffer.from(await screenshotsZip.arrayBuffer()),
				headers: { "Content-Type": "application/zip", "X-Trace-Id": traceId },
			},
		);
		expect(upload.ok()).toBeTruthy();
	}
	return traceId;
}

test("scrubbing to the end of the ruler stays a scrub in the player view", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	// Just under a power of two, where panning past the end rounds the edges.
	await viewer.loadTraceFromUrlParam(
		await createTrace(request, { durationMs: 4000 }),
		{ view: "player" },
	);
	const { stepViewer, ruler } = viewer;
	await expect(stepViewer.screenshot).toBeVisible({ timeout: 10000 });

	const start = await ruler.pointAt(0.95);
	const end = await ruler.pointAt(1);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	for (let x = Math.ceil(start.x); x <= end.x; x++) {
		await page.mouse.move(x, start.y);
		await expect(ruler.zoomWindow).toHaveCount(0);
	}
	await page.mouse.up();

	await test.step("A press on the ticks along the bottom seeks", async () => {
		const box = (await ruler.root.boundingBox())!;
		await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
		await expect(ruler.playhead).toHaveAttribute(
			"data-time-ms",
			/^(199|200)\d/,
		);
		await expect(ruler.zoomWindow).toHaveCount(0);
	});
});

test("shows the step viewer with its control bar and step ruler in the player view", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromUrlParam(await createTrace(request), {
		view: "player",
	});
	const { stepViewer, ruler } = viewer;

	await expect(stepViewer.screenshot).toBeVisible({ timeout: 10000 });
	await expect(stepViewer.controlBar).toBeVisible();
	await expect(ruler.root).toBeVisible();

	await expect(viewer.header.root).toHaveCount(0);
	await expect(viewer.steps.root).toHaveCount(0);
	await expect(viewer.browserSpans.root).toHaveCount(0);
	await expect(viewer.externalSpans.root).toHaveCount(0);
	await expect(viewer.details.root).toHaveCount(0);

	await test.step("Screenshot, control bar and ruler stack down the whole viewer", async () => {
		const viewport = page.viewportSize()!;
		const screen = (await stepViewer.screen.boundingBox())!;
		const bar = (await stepViewer.controlBar.boundingBox())!;
		const rulerBox = (await ruler.root.boundingBox())!;
		expect(screen.width).toBeCloseTo(viewport.width, 0);
		expect(screen.y + screen.height).toBeCloseTo(bar.y, 0);
		expect(bar.y + bar.height).toBeCloseTo(rulerBox.y, 0);
		expect(rulerBox.y + rulerBox.height).toBeCloseTo(viewport.height, 0);
		// The screenshot gets all the room the controls leave.
		expect(screen.height).toBeGreaterThan(viewport.height - 120);
		// Nothing sits over the screenshot.
		await expect(stepViewer.screen.getByRole("button")).toHaveCount(0);
	});

	await test.step("Hovering the ruler slides the filmstrip up over the controls", async () => {
		await expect(ruler.filmstrip.root).toBeHidden();
		await ruler.hoverAt(0.5);
		await expect(ruler.filmstrip.root).toBeVisible();
		const filmstrip = (await ruler.filmstrip.root.boundingBox())!;
		const bar = (await stepViewer.controlBar.boundingBox())!;
		const rulerBox = (await ruler.root.boundingBox())!;
		expect(filmstrip.y + filmstrip.height).toBeCloseTo(rulerBox.y, 0);
		expect(filmstrip.y).toBeLessThan(bar.y);
		// The pointer's line runs unbroken from the label into the ruler.
		const line = (await ruler.filmstrip.line.boundingBox())!;
		const label = (await ruler.filmstrip.label.boundingBox())!;
		expect(line.y).toBeCloseTo(label.y + label.height, 0);
		expect(line.y + line.height).toBeCloseTo(rulerBox.y, 0);
		await page.mouse.move(10, 10);
		await expect(ruler.filmstrip.root).toBeHidden();
	});
});

test("the player view's filmstrip shows a row per page and the control bar picks pages", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromUrlParam(await createTrace(request, { pages: 3 }), {
		view: "player",
	});
	const { stepViewer, ruler } = viewer;
	await expect(stepViewer.screenshot).toBeVisible({ timeout: 10000 });

	await expect(stepViewer.pagePicker.getByRole("button")).toHaveCount(3);
	await ruler.hoverAt(0.9);
	await expect(ruler.filmstrip.rows()).toHaveCount(3);
	const pageIds = await ruler.filmstrip
		.rows()
		.evaluateAll((rows) =>
			rows.map((row) => row.getAttribute("data-screenshot-page-id")),
		);
	expect(new Set(pageIds).size).toBe(3);
});

test("shows everything except the step viewer in the spans view", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromUrlParam(await createTrace(request), {
		view: "spans",
	});

	await expect(viewer.steps.root).toBeVisible({ timeout: 10000 });
	await expect(viewer.header.root).toBeVisible();
	await expect(viewer.timelineRuler).toBeVisible();
	await expect(viewer.browserSpans.root).toBeVisible();
	await expect(viewer.details.root).toBeVisible();
	await expect(viewer.stepViewer.root).toHaveCount(0);

	const timelineBox = (await viewer.timelineContent.boundingBox())!;
	const detailsBox = (await viewer.details.root.boundingBox())!;
	expect(detailsBox.x).toBeGreaterThanOrEqual(
		timelineBox.x + timelineBox.width,
	);

	// With no player above it, the ruler's filmstrip opens downwards.
	await viewer.ruler.hoverAt(0.5);
	await expect(viewer.ruler.filmstrip.screenshots().first()).toBeVisible();
	const rulerBox = (await viewer.timelineRuler.boundingBox())!;
	const filmstripBox = (await viewer.ruler.filmstrip.root.boundingBox())!;
	expect(
		Math.abs(filmstripBox.y - (rulerBox.y + rulerBox.height)),
	).toBeLessThanOrEqual(1);
	// Below the ruler, the frames sit between it and the label.
	const lineBox = (await viewer.ruler.filmstrip.line.boundingBox())!;
	const labelBox = (await viewer.ruler.filmstrip.label.boundingBox())!;
	expect(
		Math.abs(lineBox.y - (rulerBox.y + rulerBox.height)),
	).toBeLessThanOrEqual(1);
	expect(lineBox.y + lineBox.height).toBeCloseTo(labelBox.y, 0);
});

test("lets an explicit panels list override the view", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromUrlParam(await createTrace(request), {
		view: "player",
		panels: "viewer",
	});

	await expect(viewer.stepViewer.screenshot).toBeVisible({ timeout: 10000 });
	await expect(viewer.stepViewer.controlBar).toBeVisible();
	await expect(viewer.timelineRuler).toHaveCount(0);
});

test("only shows listed panels that have data", async ({ page, request }) => {
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromUrlParam(
		await createTrace(request, { screenshots: false }),
		{ panels: "viewer,steps,details" },
	);

	await expect(viewer.steps.spanByName("Open the app")).toBeVisible({
		timeout: 10000,
	});
	await expect(viewer.details.root).toBeVisible();
	await expect(viewer.header.root).toHaveCount(0);
	await expect(viewer.timelineRuler).toHaveCount(0);
	// Listed, but the trace has no screenshots
	await expect(viewer.stepViewer.root).toHaveCount(0);
});

test("the player view says when the test took no screenshots", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromUrlParam(
		await createTrace(request, { screenshots: false }),
		{ view: "player" },
	);
	const { stepViewer } = viewer;

	await expect(stepViewer.noScreenshots).toHaveText(
		/No screenshots were captured/,
		{ timeout: 10000 },
	);
	await expect(stepViewer.screenshot).toHaveCount(0);
	// The player keeps its controls and the step ruler
	await expect(stepViewer.controlBar).toBeVisible();
	await expect(viewer.timelineRuler).toBeVisible();
});

const VIEWER_URL = "http://localhost:9294";

/**
 * Opens a page on another origin that embeds the viewer in an iframe and
 * collects the messages it posts, returning the viewer's frame.
 */
async function embedViewer(
	page: Page,
	traceId: string,
	extraParams: Record<string, string>,
): Promise<FrameLocator> {
	const params = new URLSearchParams({
		traceSource: `${TRACE_API_URL}/playwright-otel-trace-viewer/v1/${traceId}`,
		view: "player",
		...extraParams,
	});
	// Hosted by the trace API, which is another origin than the viewer's. A
	// page made up with page.route would be blocked from framing localhost.
	await page.goto(`${TRACE_API_URL}/health`);
	await page.setContent(`<!doctype html>
		<script>
			window.received = [];
			addEventListener("message", (event) => {
				if (event.source !== document.querySelector("iframe").contentWindow) return;
				window.received.push({ origin: event.origin, data: event.data });
			});
		</script>
		<iframe src="${VIEWER_URL}/?${params}" style="width:1000px;height:500px"></iframe>`);
	return page.frameLocator("iframe");
}

test("the action button tells the embedding page to run the action", async ({
	page,
	request,
}) => {
	// Several pages, so the button has to share the end of the bar with them
	const traceId = await createTrace(request, { pages: 3 });
	const frame = await embedViewer(page, traceId, { action: "expand" });
	const controlBar = frame.getByTestId("player-control-bar");
	const expandButton = controlBar.getByRole("button", { name: "Expand trace" });
	await expect(frame.getByTestId("step-viewer-pages")).toBeVisible({
		timeout: 10000,
	});

	await test.step("It ends the control bar, after the page picker", async () => {
		const bar = (await controlBar.boundingBox())!;
		const pagePicker = (await frame
			.getByTestId("step-viewer-pages")
			.boundingBox())!;
		const button = (await expandButton.boundingBox())!;
		expect(button.x).toBeGreaterThanOrEqual(pagePicker.x + pagePicker.width);
		expect(button.x + button.width).toBeLessThanOrEqual(bar.x + bar.width);
	});

	await expandButton.click();
	await expect
		.poll(() => page.evaluate("window.received"))
		.toEqual([
			{
				origin: VIEWER_URL,
				data: { type: "trace-viewer:action", action: "expand" },
			},
		]);
});

test("shows no action button unless the embedding page asks for one", async ({
	page,
	request,
}) => {
	const traceId = await createTrace(request);
	const frame = await embedViewer(page, traceId, {});
	await expect(frame.getByTestId("player-control-bar")).toBeVisible({
		timeout: 10000,
	});
	await expect(frame.getByRole("button", { name: "Expand trace" })).toHaveCount(
		0,
	);
});

test("shows no action button with no embedding page to hear it", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromUrlParam(await createTrace(request), {
		view: "player",
		action: "expand",
	});
	await expect(viewer.stepViewer.controlBar).toBeVisible({ timeout: 10000 });
	await expect(viewer.stepViewer.expandButton).toHaveCount(0);
});

test("panels from the URL neither use nor change the saved viewer settings", async ({
	page,
	request,
}) => {
	const traceId = await createTrace(request);
	const viewer = new TraceViewerPage(page);

	await test.step("Save a setting hiding the step viewer", async () => {
		await viewer.loadTraceFromUrlParam(traceId);
		await expect(viewer.stepViewer.root).toBeVisible({ timeout: 10000 });
		await viewer.settings.toggle("Step viewer");
		await expect(viewer.stepViewer.root).toBeHidden();
	});

	await test.step("The player view shows it anyway", async () => {
		await viewer.loadTraceFromUrlParam(traceId, { view: "player" });
		await expect(viewer.stepViewer.root).toBeVisible({ timeout: 10000 });
	});

	await test.step("Changing settings under a view isn't saved", async () => {
		await viewer.loadTraceFromUrlParam(traceId, { view: "spans" });
		await expect(viewer.steps.root).toBeVisible({ timeout: 10000 });
		await viewer.settings.toggle("Steps timeline");
		await expect(viewer.steps.root).toBeHidden();

		await viewer.loadTraceFromUrlParam(traceId);
		await expect(viewer.steps.root).toBeVisible({ timeout: 10000 });
		// The setting saved before any view still applies
		await expect(viewer.stepViewer.root).toBeHidden();
	});
});
