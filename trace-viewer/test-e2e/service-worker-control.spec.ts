import { Buffer } from "node:buffer";
import { expect, type Page, test } from "@playwright/test";
import {
	StepViewerComponent,
	TRACE_API_URL,
} from "./page-objects/trace-viewer-page";
import { createScreenshotsZipFromOffsets } from "./screenshot-zip";
import { generateTraceId, TraceDataBuilder } from "./test-data-builder";

/** Well under the 10s a page waits for a worker before it gives up. */
const TAKES_CONTROL_TIMEOUT_MS = 5000;

/** Reloads as Shift+Reload does, bypassing the service worker. */
async function hardReload(page: Page): Promise<void> {
	const session = await page.context().newCDPSession(page);
	const loaded = page.waitForEvent("load");
	await session.send("Page.reload", { ignoreCache: true });
	await loaded;
	await session.detach();
}

function waitForServiceWorkerControl(page: Page): Promise<unknown> {
	return page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

test("a hard reload keeps showing a remote trace through the service worker", async ({
	page,
	request,
}) => {
	const traceId = generateTraceId();
	const testStartTime = Date.now();
	const builder = new TraceDataBuilder(traceId, testStartTime).addTestSpan(
		"Hard reload",
		1000,
	);
	builder.addStepSpanAndGetId("Open the shop", 500, { startOffsetMs: 0 });
	await builder.send(request);
	const zip = await createScreenshotsZipFromOffsets({
		testStartTime,
		screenshotOffsetsMs: [100, 500],
	});
	const upload = await request.put(
		`${TRACE_API_URL}/playwright-otel-reporter/v1/screenshots.zip`,
		{
			data: Buffer.from(await zip.arrayBuffer()),
			headers: { "Content-Type": "application/zip", "X-Trace-Id": traceId },
		},
	);
	expect(upload.ok()).toBeTruthy();

	const traceSource = `${TRACE_API_URL}/playwright-otel-trace-viewer/v1/${traceId}`;
	await page.goto(`/?traceSource=${encodeURIComponent(traceSource)}`);
	const stepViewer = new StepViewerComponent(page);
	const workerScreenshot = new RegExp(
		`^/playwright-otel-trace-viewer/v1/${traceId}/screenshots/`,
	);
	await expect(stepViewer.screenshot).toHaveAttribute("src", workerScreenshot);
	await waitForServiceWorkerControl(page);

	await hardReload(page);

	await expect(stepViewer.screenshot).toHaveAttribute("src", workerScreenshot, {
		timeout: TAKES_CONTROL_TIMEOUT_MS,
	});
});

test("a local ZIP loads after a hard reload", async ({ page }) => {
	const dropZip = () =>
		page.locator('input[type="file"]').setInputFiles({
			name: "trace.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("not a trace zip"),
		});
	// Only a worker that got the file can tell it isn't a ZIP.
	const rejectedByWorker = page.getByText("File format is not recognized");

	await page.goto("/");
	await dropZip();
	await expect(rejectedByWorker).toBeVisible();
	await waitForServiceWorkerControl(page);

	await hardReload(page);
	await dropZip();

	await expect(rejectedByWorker).toBeVisible({
		timeout: TAKES_CONTROL_TIMEOUT_MS,
	});
});
