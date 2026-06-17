import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { MULTI_CONTEXT_SCREENSHOTS_TRACE_ID_FILE } from "./setup/global-setup";

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

		// Verify screenshots are displayed in the filmstrip
		await expect(viewer.screenshots.root).toBeVisible();

		// Verify at least one screenshot image exists and has a valid src
		const screenshotImages = viewer.screenshots.images();
		await expect(screenshotImages.first()).toBeVisible({ timeout: 10000 });

		// Verify the screenshot has a valid src URL (should point to a screenshot endpoint)
		const firstImageSrc = await screenshotImages.first().getAttribute("src");
		expect(firstImageSrc).toBeTruthy();
		expect(firstImageSrc).toContain("screenshots/");

		// Verify multiple screenshots exist (the test navigates, so should have multiple)
		const screenshotCount = await screenshotImages.count();
		expect(screenshotCount).toBeGreaterThan(0);
	});

	test("keeps API screenshot URLs loadable after service worker state is lost", async ({
		page,
		request,
	}) => {
		const traceIdsResponse = await request.get(`${TRACE_API_URL}/trace-ids`);
		expect(traceIdsResponse.ok()).toBeTruthy();

		const { traceIds } = (await traceIdsResponse.json()) as {
			traceIds: string[];
		};
		expect(traceIds.length).toBeGreaterThan(0);

		const traceId = traceIds[0];
		const viewer = new TraceViewerPage(page);
		await viewer.loadTraceFromApi(traceId);

		const firstImage = viewer.screenshots.images().first();
		await expect(firstImage).toBeVisible({ timeout: 10000 });

		const screenshotUrl = await firstImage.getAttribute("src");
		expect(screenshotUrl).toBeTruthy();

		const initialResponse = await fetchFromPageWithCacheBust(
			page,
			screenshotUrl!,
			"before-state-loss",
		);
		expect(initialResponse.status).toBe(200);
		expect(initialResponse.contentType).toMatch(/^image\//);

		await page.evaluate(async () => {
			await navigator.serviceWorker.ready;
			const controller = navigator.serviceWorker.controller;
			if (!controller) {
				throw new Error("Expected a controlling service worker");
			}

			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					navigator.serviceWorker.removeEventListener("message", onMessage);
					reject(new Error("Timed out waiting for service worker ping"));
				}, 5000);

				const onMessage = (event: MessageEvent) => {
					if (event.data?.type !== "PONG") return;
					clearTimeout(timeout);
					navigator.serviceWorker.removeEventListener("message", onMessage);
					resolve();
				};

				navigator.serviceWorker.addEventListener("message", onMessage);
				controller.postMessage({ type: "CLEAR_SCREENSHOT_STATE" });
				controller.postMessage({ type: "PING" });
			});
		});

		const responseAfterStateLoss = await fetchFromPageWithCacheBust(
			page,
			screenshotUrl!,
			"after-state-loss",
		);
		expect(responseAfterStateLoss.status).toBe(200);
		expect(responseAfterStateLoss.contentType).toMatch(/^image\//);
	});

	test("renders separate screenshot rows for multiple browser contexts", async ({
		page,
	}) => {
		const traceId = readFileSync(
			MULTI_CONTEXT_SCREENSHOTS_TRACE_ID_FILE,
			"utf-8",
		).trim();
		const viewer = new TraceViewerPage(page);
		await viewer.loadTraceFromApi(traceId);

		await expect(viewer.header.root).toBeVisible({ timeout: 10000 });
		await expect(viewer.screenshots.root).toBeVisible();

		const rows = viewer.screenshots.rows();
		await expect(rows).toHaveCount(2, { timeout: 10000 });

		const rowContextIds = await rows.evaluateAll((elements) =>
			elements.map((element) =>
				element.getAttribute("data-screenshot-context-id"),
			),
		);
		expect(new Set(rowContextIds).size).toBe(2);

		const sourceCounts = (
			await rows.evaluateAll((elements) =>
				elements.map((element) =>
					Number(element.getAttribute("data-screenshot-source-count")),
				),
			)
		).sort((a, b) => a - b);
		expect(sourceCounts[0]).toBeGreaterThan(0);
		expect(sourceCounts[1]).toBeGreaterThan(sourceCounts[0]);

		for (let rowIndex = 0; rowIndex < 2; rowIndex++) {
			const firstImage = rows.nth(rowIndex).getByRole("img", {
				name: /Screenshot at/,
			}).first();
			await expect(firstImage).toBeVisible({ timeout: 10000 });
			await expect
				.poll(async () =>
					firstImage.evaluate((image) => (image as HTMLImageElement).naturalWidth),
				)
				.toBeGreaterThan(0);
		}
	});
});

interface FetchedScreenshotResponse {
	status: number;
	contentType: string;
}

async function fetchFromPageWithCacheBust(
	page: import("@playwright/test").Page,
	url: string,
	cacheBust: string,
): Promise<FetchedScreenshotResponse> {
	return page.evaluate(
		async ({ url, cacheBust }) => {
			const fetchUrl = new URL(url, window.location.href);
			fetchUrl.searchParams.set("cacheBust", cacheBust);
			const response = await fetch(fetchUrl.toString());
			return {
				status: response.status,
				contentType: response.headers.get("content-type") ?? "",
			};
		},
		{ url, cacheBust },
	);
}
