import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
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
	options: { screenshots?: boolean; pages?: number } = {},
): Promise<string> {
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();
	await new TraceDataBuilder(traceId, testStartTime)
		.addTestSpan("Viewer panels", 3000)
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

/** Rows naming panels that are shown but have no data */
function disabledRows(viewer: TraceViewerPage) {
	return viewer.root.locator(".cursor-not-allowed");
}

test("shows the step viewer, ruler and filmstrip in the player view", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromUrlParam(await createTrace(request), {
		view: "player",
	});

	await expect(viewer.screenshots.images().first()).toBeVisible({
		timeout: 10000,
	});
	await expect(viewer.stepViewer.root).toBeVisible();
	await expect(viewer.timelineRuler).toBeVisible();

	await expect(viewer.header.root).toHaveCount(0);
	await expect(viewer.steps.root).toHaveCount(0);
	await expect(viewer.browserSpans.root).toHaveCount(0);
	await expect(viewer.externalSpans.root).toHaveCount(0);
	await expect(viewer.details.root).toHaveCount(0);
	// Panels the view leaves out aren't listed as empty either
	await expect(disabledRows(viewer)).toHaveCount(0);

	const stepViewerBox = (await viewer.stepViewer.root.boundingBox())!;
	const rulerBox = (await viewer.timelineRuler.boundingBox())!;
	const filmstripBox = (await viewer.screenshots.root.boundingBox())!;
	expect(stepViewerBox.y + stepViewerBox.height).toBeLessThanOrEqual(
		rulerBox.y,
	);
	expect(rulerBox.y + rulerBox.height).toBeLessThanOrEqual(filmstripBox.y);
	expect(stepViewerBox.width).toBeCloseTo(filmstripBox.width, 0);
	expect(stepViewerBox.height).toBeGreaterThan(filmstripBox.height);
});

test("the player view's filmstrip gets more room for several pages", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	const heights = async (traceId: string) => {
		await viewer.loadTraceFromUrlParam(traceId, { view: "player" });
		await expect(viewer.screenshots.images().first()).toBeVisible({
			timeout: 10000,
		});
		return {
			stepViewer: (await viewer.stepViewer.root.boundingBox())!.height,
			filmstrip: (await viewer.screenshots.root.boundingBox())!.height,
		};
	};

	const onePage = await test.step("One page", async () =>
		heights(await createTrace(request)));
	const threePages = await test.step("Three pages", async () => {
		const traceId = await createTrace(request, { pages: 3 });
		await viewer.loadTraceFromUrlParam(traceId, { view: "player" });
		await expect(viewer.screenshots.rows()).toHaveCount(3, { timeout: 10000 });
		return heights(traceId);
	});

	expect(threePages.filmstrip).toBeGreaterThan(onePage.filmstrip * 1.4);
	expect(threePages.stepViewer).toBeLessThan(onePage.stepViewer);
	// The screenshot still gets most of the room.
	expect(threePages.stepViewer).toBeGreaterThan(threePages.filmstrip);
});

test("shows everything except the step viewer in the spans view", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromUrlParam(await createTrace(request), {
		view: "spans",
	});

	await expect(viewer.screenshots.images().first()).toBeVisible({
		timeout: 10000,
	});
	await expect(viewer.header.root).toBeVisible();
	await expect(viewer.timelineRuler).toBeVisible();
	await expect(viewer.steps.root).toBeVisible();
	await expect(viewer.browserSpans.root).toBeVisible();
	await expect(viewer.details.root).toBeVisible();
	await expect(viewer.stepViewer.root).toHaveCount(0);

	const timelineBox = (await viewer.timelineContent.boundingBox())!;
	const detailsBox = (await viewer.details.root.boundingBox())!;
	expect(detailsBox.x).toBeGreaterThanOrEqual(
		timelineBox.x + timelineBox.width,
	);
});

test("lets an explicit panels list override the view", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromUrlParam(await createTrace(request), {
		view: "player",
		panels: "viewer,filmstrip",
	});

	await expect(viewer.screenshots.images().first()).toBeVisible({
		timeout: 10000,
	});
	await expect(viewer.stepViewer.root).toBeVisible();
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
	// Not listed, so not shown as empty sections either
	await expect(disabledRows(viewer)).toHaveCount(0);
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
