import { expect, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";

test.describe("reporter, trace-api, trace-viewer flow", () => {
	test("loads and displays a real trace from reporter e2e tests", async ({
		page,
		request,
	}) => {
		// Fetch the list of available trace IDs from the trace-api-server
		const traceIdsResponse = await request.get(`${TRACE_API_URL}/trace-ids`);
		expect(traceIdsResponse.ok()).toBeTruthy();

		const { traceIds } = (await traceIdsResponse.json()) as {
			traceIds: string[];
		};

		// Verify we have at least one trace
		expect(traceIds.length).toBeGreaterThan(0);

		// Load the first trace in the viewer
		const traceId = traceIds[0];
		const viewer = new TraceViewerPage(page);
		await viewer.loadTraceFromApi(traceId);

		// Wait for the trace to load
		await expect(viewer.header.root).toBeVisible({ timeout: 10000 });

		// Verify we can see the test name (should be from reporter/test-e2e/example.spec.ts)
		const testName = await viewer.header.root.textContent();
		expect(testName).toBeTruthy();

		await expect(viewer.header.status).toHaveText("passed");

		// Browser spans should be rendered in the Browser Spans section, not just anywhere on the page.
		await expect(viewer.browserSpans.root).toBeVisible({ timeout: 10000 });
		await expect(viewer.browserSpans.spans().first()).toBeVisible({
			timeout: 10000,
		});

		// Verify rrweb replay frames are displayed in the filmstrip
		await expect(viewer.replay.root).toBeVisible();

		const replayFrames = viewer.replay.frames();
		await expect(replayFrames.first()).toBeVisible({ timeout: 10000 });

		const replayFrameCount = await replayFrames.count();
		expect(replayFrameCount).toBeGreaterThan(0);
	});
});
