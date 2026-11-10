import { randomUUID } from "node:crypto";
import {
	type APIRequestContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import {
	StepViewerComponent,
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { createScreenshotsZipFromOffsets } from "./screenshot-zip";
import { TraceDataBuilder } from "./test-data-builder";

async function createTrace(request: APIRequestContext): Promise<string> {
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();
	await new TraceDataBuilder(traceId, testStartTime)
		.addTestSpan("Loading skeleton", 3000)
		.addStepSpan("Open the app", 400, { startOffsetMs: 100 })
		.send(request);

	const zip = await createScreenshotsZipFromOffsets({
		testStartTime,
		screenshotOffsetsMs: [0, 1000, 2000],
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

/** Holds the trace's spans back until the returned function is called. */
async function holdTraceSpans(page: Page): Promise<() => void> {
	let release!: () => void;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(`${TRACE_API_URL}/**/traces*`, async (route) => {
		await released;
		await route.continue();
	});
	return release;
}

test("shows the player's layout while the trace loads, where the player will be", async ({
	page,
	request,
}) => {
	const traceId = await createTrace(request);
	await page.setViewportSize({ width: 900, height: 512 });
	const release = await holdTraceSpans(page);
	const viewer = new TraceViewerPage(page);
	const stepViewer = new StepViewerComponent(page);

	await viewer.loadTraceFromUrlParam(traceId, { view: "player" });

	const skeleton = page.getByRole("status", { name: "Loading trace" });
	await expect(skeleton).toBeVisible();
	await expect(page.getByText("Loading trace...")).toBeHidden();
	const skeletonScreen = await skeleton
		.getByTestId("screenshot-skeleton")
		.boundingBox();

	release();
	await expect(stepViewer.screenshot).toBeVisible();
	await expect(skeleton).toHaveCount(0);

	// The screenshot fills in where its skeleton was.
	const screen = await stepViewer.screen.boundingBox();
	const padding = 12;
	expect(skeletonScreen).toEqual({
		x: screen!.x + padding,
		y: screen!.y + padding,
		width: screen!.width - 2 * padding,
		height: screen!.height - 2 * padding,
	});
});

test("shows the full viewer's regions while the trace loads", async ({
	page,
	request,
}) => {
	const traceId = await createTrace(request);
	const release = await holdTraceSpans(page);
	const viewer = new TraceViewerPage(page);

	await viewer.loadTraceFromUrlParam(traceId, { view: "full" });

	const skeleton = page.getByRole("status", { name: "Loading trace" });
	await expect(skeleton).toBeVisible();
	await expect(skeleton.getByTestId("screenshot-skeleton")).toBeVisible();

	release();
	await expect(page.getByTestId("trace-viewer-header")).toBeVisible();
	await expect(skeleton).toHaveCount(0);
});
