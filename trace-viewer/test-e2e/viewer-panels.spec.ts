import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { TraceViewerPage } from "./page-objects/trace-viewer-page";
import { MULTI_CONTEXT_SCREENSHOTS_TRACE_ID_FILE } from "./setup/global-setup";
import { TraceDataBuilder } from "./test-data-builder";

function multiContextScreenshotsTraceId(): string {
	return readFileSync(MULTI_CONTEXT_SCREENSHOTS_TRACE_ID_FILE, "utf-8").trim();
}

test("docks the screenshot viewer above the details sidebar by default", async ({
	page,
}) => {
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromUrlParam(multiContextScreenshotsTraceId());

	await expect(viewer.header.root).toBeVisible({ timeout: 10000 });
	await expect(viewer.timelineRuler).toBeVisible();
	await expect(viewer.screenshots.root).toBeVisible();
	await expect(viewer.screenshotViewer.root).toBeVisible();
	await expect(viewer.details.root).toBeVisible();

	const timelineBox = (await viewer.timelineContent.boundingBox())!;
	const viewerBox = (await viewer.screenshotViewer.root.boundingBox())!;
	const detailsBox = (await viewer.details.root.boundingBox())!;

	expect(viewerBox.x).toBeGreaterThanOrEqual(timelineBox.x + timelineBox.width);
	expect(viewerBox.x).toBeCloseTo(detailsBox.x, 0);
	expect(viewerBox.y + viewerBox.height).toBeLessThanOrEqual(detailsBox.y);
});

test("shows the screenshot viewer, ruler and filmstrip in the player view", async ({
	page,
}) => {
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromUrlParam(multiContextScreenshotsTraceId(), {
		view: "player",
	});

	await expect(viewer.screenshots.images().first()).toBeVisible({
		timeout: 10000,
	});
	await expect(viewer.screenshotViewer.root).toBeVisible();
	await expect(viewer.timelineRuler).toBeVisible();

	await expect(viewer.header.root).toHaveCount(0);
	await expect(viewer.steps.root).toHaveCount(0);
	await expect(viewer.browserSpans.root).toHaveCount(0);
	await expect(viewer.externalSpans.root).toHaveCount(0);
	await expect(viewer.details.root).toHaveCount(0);
	await expect(page.getByText("Steps Timeline")).toHaveCount(0);

	const viewerBox = (await viewer.screenshotViewer.root.boundingBox())!;
	const rulerBox = (await viewer.timelineRuler.boundingBox())!;
	const filmstripBox = (await viewer.screenshots.root.boundingBox())!;
	expect(viewerBox.y + viewerBox.height).toBeLessThanOrEqual(rulerBox.y);
	expect(rulerBox.y + rulerBox.height).toBeLessThanOrEqual(filmstripBox.y);
	expect(viewerBox.width).toBeCloseTo(filmstripBox.width, 0);
	expect(viewerBox.height).toBeGreaterThan(filmstripBox.height);

	const row = viewer.screenshots.rows().first();
	const thumbnail = row.locator("[data-screenshot-timestamp]").first();
	const pageId = await thumbnail.getAttribute("data-screenshot-page-id");
	await thumbnail.hover();
	await expect(viewer.screenshotViewer.screenshot()).toHaveAttribute(
		"data-screenshot-page-id",
		pageId!,
	);
	await expect(
		viewer.screenshotViewer.screenshot().locator("img"),
	).toBeVisible();
});

test("shows everything except the screenshot viewer in the spans view", async ({
	page,
}) => {
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromUrlParam(multiContextScreenshotsTraceId(), {
		view: "spans",
	});

	await expect(viewer.screenshots.images().first()).toBeVisible({
		timeout: 10000,
	});
	await expect(viewer.header.root).toBeVisible();
	await expect(viewer.timelineRuler).toBeVisible();
	await expect(viewer.steps.root).toBeVisible();
	await expect(viewer.details.root).toBeVisible();
	await expect(viewer.screenshotViewer.root).toHaveCount(0);

	// The details panel fills the whole sidebar without the screenshot viewer
	const timelineBox = (await viewer.timelineContent.boundingBox())!;
	const detailsBox = (await viewer.details.root.boundingBox())!;
	expect(detailsBox.x).toBeGreaterThanOrEqual(
		timelineBox.x + timelineBox.width,
	);
	expect(detailsBox.y).toBeLessThanOrEqual(timelineBox.y);
});

test("lets an explicit panels list override the view", async ({ page }) => {
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromUrlParam(multiContextScreenshotsTraceId(), {
		view: "player",
		panels: "viewer,filmstrip",
	});

	await expect(viewer.screenshots.images().first()).toBeVisible({
		timeout: 10000,
	});
	await expect(viewer.screenshotViewer.root).toBeVisible();
	await expect(viewer.timelineRuler).toHaveCount(0);
});

test("only shows listed panels that have data", async ({ page, request }) => {
	const traceId = randomUUID().replaceAll("-", "");
	await new TraceDataBuilder(traceId, Date.now())
		.addTestSpan("Panels without screenshots", 1000, {
			file: "viewer-panels.spec.ts",
			line: 1,
		})
		.addStepSpan("Do a thing", 500, { startOffsetMs: 100 })
		.send(request);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromUrlParam(traceId, {
		panels: "viewer,steps,details",
	});

	await expect(viewer.steps.spanByName("Do a thing")).toBeVisible({
		timeout: 10000,
	});
	await expect(viewer.details.root).toBeVisible();
	await expect(viewer.header.root).toHaveCount(0);
	await expect(viewer.timelineRuler).toHaveCount(0);
	// Listed, but the trace has no screenshots
	await expect(viewer.screenshotViewer.root).toHaveCount(0);
	// Not listed, so not even shown as a disabled section
	await expect(page.getByText("Screenshots", { exact: true })).toHaveCount(0);
	await expect(page.getByText("Browser Spans", { exact: true })).toHaveCount(0);
});
