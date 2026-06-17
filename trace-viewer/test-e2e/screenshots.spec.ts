import { readFileSync } from "node:fs";
import { expect, type Locator, test } from "@playwright/test";
import { BlobWriter, ZipWriter } from "@zip.js/zip.js";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { MULTI_CONTEXT_SCREENSHOTS_TRACE_ID_FILE } from "./setup/global-setup";
import { TraceDataBuilder } from "./test-data-builder";

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
		const firstImage = rows
			.nth(rowIndex)
			.getByRole("img", {
				name: /Screenshot at/,
			})
			.first();
		await expect(firstImage).toBeVisible({ timeout: 10000 });
		await expect
			.poll(async () =>
				firstImage.evaluate(
					(image) => (image as HTMLImageElement).naturalWidth,
				),
			)
			.toBeGreaterThan(0);
	}
});

test("shows three screenshot rows by default and scrolls to additional rows", async ({
	page,
	request,
}) => {
	const traceId = "55000000000000000000000000000001";
	const testStartTime = Date.now();
	const screenshotsZip = await createScreenshotsZip({
		testStartTime,
		contextCount: 4,
		pagesPerContext: 2,
	});

	await new TraceDataBuilder(traceId, testStartTime)
		.addTestSpan("Scrollable screenshot contexts", 4000, {
			file: "screenshots.spec.ts",
			line: 1,
		})
		.addStepSpan("Render contexts", 1000, { startOffsetMs: 500 })
		.send(request);

	await request.put(
		`${TRACE_API_URL}/playwright-otel-reporter/v1/screenshots.zip`,
		{
			data: Buffer.from(await screenshotsZip.arrayBuffer()),
			headers: {
				"Content-Type": "application/zip",
				"X-Trace-Id": traceId,
			},
		},
	);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	await expect(viewer.header.testName).toHaveText(
		"Scrollable screenshot contexts",
	);

	const rows = viewer.screenshots.rows();
	await expect(rows).toHaveCount(4, { timeout: 10000 });
	await expect
		.poll(() =>
			viewer.screenshots.root.evaluate(
				(element) => element.scrollHeight > element.clientHeight,
			),
		)
		.toBe(true);

	for (let rowIndex = 0; rowIndex < 4; rowIndex++) {
		await expect(rows.nth(rowIndex)).toHaveAttribute(
			"data-screenshot-source-count",
			"2",
		);
		const pageIds = await rows
			.nth(rowIndex)
			.getAttribute("data-screenshot-page-ids");
		expect(pageIds?.split(",")).toHaveLength(2);
	}

	await expect
		.poll(() => visibleRatioInScreenshotRegion(rows.nth(0)))
		.toBeGreaterThan(0.95);
	await expect
		.poll(() => visibleRatioInScreenshotRegion(rows.nth(1)))
		.toBeGreaterThan(0.95);
	await expect
		.poll(() => visibleRatioInScreenshotRegion(rows.nth(2)))
		.toBeGreaterThan(0.95);
	expect(await visibleRatioInScreenshotRegion(rows.nth(3))).toBeLessThan(0.05);

	await viewer.screenshots.root.hover();
	await page.mouse.wheel(0, 1000);

	await expect
		.poll(() =>
			viewer.screenshots.root.evaluate((element) => element.scrollTop),
		)
		.toBeGreaterThan(0);
	await expect
		.poll(() => visibleRatioInScreenshotRegion(rows.nth(3)))
		.toBeGreaterThan(0.95);
});

interface CreateScreenshotsZipOptions {
	testStartTime: number;
	contextCount: number;
	pagesPerContext: number;
}

async function createScreenshotsZip({
	testStartTime,
	contextCount,
	pagesPerContext,
}: CreateScreenshotsZipOptions): Promise<Blob> {
	const blobWriter = new BlobWriter("application/zip");
	const zipWriter = new ZipWriter(blobWriter);
	const screenshots: Array<{
		timestamp: number;
		file: string;
		path: string;
		contentType: string;
		contextId: string;
		pageId: string;
	}> = [];

	for (let contextIndex = 1; contextIndex <= contextCount; contextIndex++) {
		const contextId = `context-${contextIndex}`;
		for (let pageIndex = 1; pageIndex <= pagesPerContext; pageIndex++) {
			const pageId = `${contextId}-page-${pageIndex}`;
			const timestamp = testStartTime + contextIndex * 100 + pageIndex * 10;
			const file = `${pageId}-${timestamp}.svg`;
			const path = `screenshots/${file}`;

			screenshots.push({
				timestamp,
				file,
				path,
				contentType: "image/svg+xml",
				contextId,
				pageId,
			});
			await zipWriter.add(
				path,
				new Blob([screenshotSvg(contextId, pageId)], {
					type: "image/svg+xml",
				}).stream(),
			);
		}
	}

	await zipWriter.add(
		"manifest.json",
		new Blob([
			JSON.stringify({
				version: 2,
				screenshots,
			}),
		]).stream(),
	);

	return zipWriter.close();
}

function screenshotSvg(contextId: string, pageId: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#dbeafe"/><text x="320" y="165" text-anchor="middle" font-family="Arial, sans-serif" font-size="36" fill="#1e3a8a">${contextId}</text><text x="320" y="215" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" fill="#1e40af">${pageId}</text></svg>`;
}

async function visibleRatioInScreenshotRegion(row: Locator): Promise<number> {
	return row.evaluate((element) => {
		const region = element.closest(
			'[role="region"][aria-label="Screenshots"]',
		) as HTMLElement | null;
		if (!region) return 0;

		const rowRect = element.getBoundingClientRect();
		const regionRect = region.getBoundingClientRect();
		const visibleHeight = Math.max(
			0,
			Math.min(rowRect.bottom, regionRect.bottom) -
				Math.max(rowRect.top, regionRect.top),
		);
		return visibleHeight / rowRect.height;
	});
}
