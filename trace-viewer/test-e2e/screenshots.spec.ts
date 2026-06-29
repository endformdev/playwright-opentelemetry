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

	await expectDetailsToMatchHoveredScreenshot(viewer, rows.nth(0));
	await expectDetailsToMatchHoveredScreenshot(viewer, rows.nth(1));
});

test("shows separate page rows with two and a half rows by default", async ({
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
	await expect(rows).toHaveCount(8, { timeout: 10000 });
	await expect
		.poll(() =>
			viewer.screenshots.root.evaluate(
				(element) => element.scrollHeight > element.clientHeight,
			),
		)
		.toBe(true);

	for (let rowIndex = 0; rowIndex < 8; rowIndex++) {
		await expect(rows.nth(rowIndex)).toHaveAttribute(
			"data-screenshot-source-count",
			"1",
		);
		const pageIds = await rows
			.nth(rowIndex)
			.getAttribute("data-screenshot-page-ids");
		expect(pageIds?.split(",")).toHaveLength(1);
	}
	const pageIdRows = await rows.evaluateAll((elements) =>
		elements.map((element) => ({
			contextId: element.getAttribute("data-screenshot-context-id"),
			pageIds: element.getAttribute("data-screenshot-page-ids"),
		})),
	);
	expect(
		new Set(pageIdRows.map((row) => `${row.contextId}:${row.pageIds}`)).size,
	).toBe(8);

	await expect
		.poll(() => visibleRatioInScreenshotRegion(rows.nth(0)))
		.toBeGreaterThan(0.95);
	await expectDetailsToMatchHoveredScreenshot(viewer, rows.nth(0));
	await expect
		.poll(() => visibleRatioInScreenshotRegion(rows.nth(1)))
		.toBeGreaterThan(0.95);
	await expectDetailsToMatchHoveredScreenshot(viewer, rows.nth(1));
	await expect
		.poll(() => visibleRatioInScreenshotRegion(rows.nth(2)))
		.toBeGreaterThan(0.35);
	expect(await visibleRatioInScreenshotRegion(rows.nth(2))).toBeLessThan(0.65);
	expect(await visibleRatioInScreenshotRegion(rows.nth(3))).toBeLessThan(0.05);

	await viewer.screenshots.root.hover();
	await page.mouse.wheel(0, 1000);

	await expect
		.poll(() =>
			viewer.screenshots.root.evaluate((element) => element.scrollTop),
		)
		.toBeGreaterThan(0);
	await expect
		.poll(() => visibleRatioInScreenshotRegion(rows.nth(7)))
		.toBeGreaterThan(0.95);
	await expectDetailsToMatchHoveredScreenshot(viewer, rows.nth(7));
});

test("shows the most recent screenshot at the hovered timestamp when filmstrip frames are sampled", async ({
	page,
	request,
}) => {
	const traceId = "55000000000000000000000000000002";
	const testStartTime = Date.now();
	const testDurationMs = 10_000;
	const screenshotOffsetsMs = Array.from(
		{ length: 101 },
		(_, index) => index * 100,
	);
	const screenshotsZip = await createScreenshotsZipFromOffsets({
		testStartTime,
		screenshotOffsetsMs,
	});

	await new TraceDataBuilder(traceId, testStartTime)
		.addTestSpan(
			"Dense screenshots are sampled in the filmstrip",
			testDurationMs,
			{
				file: "screenshots.spec.ts",
				line: 1,
			},
		)
		.addStepSpan("Interact with the page", testDurationMs, { startOffsetMs: 0 })
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
		"Dense screenshots are sampled in the filmstrip",
	);

	const row = viewer.screenshots.rows().first();
	await expect(row).toHaveAttribute(
		"data-screenshot-source-count",
		String(screenshotOffsetsMs.length),
		{ timeout: 10000 },
	);
	await expect(viewer.screenshots.images().first()).toBeVisible({
		timeout: 10000,
	});
	await expect
		.poll(() => row.locator("[data-screenshot-timestamp]").count())
		.toBeLessThan(screenshotOffsetsMs.length);

	const target = await findHiddenScreenshotHoverTarget(row, {
		testStartTime,
		testDurationMs,
		screenshotOffsetsMs,
	});
	expect(target.displayedTimestamp).not.toBe(target.expectedTimestamp);

	await page.mouse.move(target.x, target.y);
	await expect(viewer.details.screenshot()).toHaveAttribute(
		"data-screenshot-timestamp",
		String(target.expectedTimestamp),
	);
});

test("focuses the active screenshot when moving from a span into a filmstrip gap", async ({
	page,
	request,
}) => {
	const traceId = "55000000000000000000000000000003";
	const testStartTime = Date.now();
	const testDurationMs = 10_000;
	const screenshotsZip = await createScreenshotsZipFromOffsets({
		testStartTime,
		screenshotOffsetsMs: [0, 2_000, 4_000, 6_000, 8_000],
	});
	const builder = new TraceDataBuilder(traceId, testStartTime).addTestSpan(
		"Screenshot focus from span hover",
		testDurationMs,
		{
			file: "screenshots.spec.ts",
			line: 1,
		},
	);

	for (let index = 1; index <= 24; index++) {
		builder.addStepSpan(
			index === 24 ? "Focus target step" : `Active step ${index}`,
			testDurationMs,
			{ startOffsetMs: 0 },
		);
	}

	await builder.send(request);
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
		"Screenshot focus from span hover",
	);
	await expect(viewer.screenshots.images().first()).toBeVisible({
		timeout: 10000,
	});

	const row = viewer.screenshots.rows().first();
	const gapTarget = await findFilmstripGapHoverTarget(row);
	const targetStep = viewer.steps.spanByName("Focus target step").first();
	await targetStep.scrollIntoViewIfNeeded();
	await expect(targetStep).toBeVisible();

	const targetStepId = await targetStep.getAttribute("data-span-id");
	if (!targetStepId) {
		throw new Error("Focus target step is missing data-span-id");
	}
	const targetStepBox = await targetStep.boundingBox();
	if (!targetStepBox) {
		throw new Error("Focus target step is not visible");
	}

	await page.mouse.move(
		gapTarget.x,
		targetStepBox.y + targetStepBox.height / 2,
	);
	await expect(viewer.details.spanDetailsById(targetStepId)).toBeVisible();
	await expect
		.poll(() => viewer.details.root.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(0);

	await page.mouse.move(gapTarget.x, gapTarget.y, { steps: 8 });
	await expect(viewer.details.screenshot()).toHaveAttribute(
		"data-screenshot-timestamp",
		/\d+/,
	);
	await expect
		.poll(() => viewer.details.root.evaluate((element) => element.scrollTop))
		.toBeLessThanOrEqual(2);
});

interface CreateScreenshotsZipOptions {
	testStartTime: number;
	contextCount: number;
	pagesPerContext: number;
}

interface CreateScreenshotsZipFromOffsetsOptions {
	testStartTime: number;
	screenshotOffsetsMs: number[];
	contextId?: string;
	pageId?: string;
}

interface ScreenshotManifestEntry {
	timestamp: number;
	file: string;
	path: string;
	contentType: string;
	contextId: string;
	pageId: string;
}

async function createScreenshotsZip({
	testStartTime,
	contextCount,
	pagesPerContext,
}: CreateScreenshotsZipOptions): Promise<Blob> {
	const blobWriter = new BlobWriter("application/zip");
	const zipWriter = new ZipWriter(blobWriter);
	const screenshots: ScreenshotManifestEntry[] = [];

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

async function createScreenshotsZipFromOffsets({
	testStartTime,
	screenshotOffsetsMs,
	contextId = "context-1",
	pageId = "context-1-page-1",
}: CreateScreenshotsZipFromOffsetsOptions): Promise<Blob> {
	const blobWriter = new BlobWriter("application/zip");
	const zipWriter = new ZipWriter(blobWriter);
	const screenshots: ScreenshotManifestEntry[] = [];

	for (const offsetMs of screenshotOffsetsMs) {
		const timestamp = testStartTime + offsetMs;
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
			new Blob([screenshotSvg(contextId, `${pageId} @ ${offsetMs}ms`)], {
				type: "image/svg+xml",
			}).stream(),
		);
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

async function findHiddenScreenshotHoverTarget(
	row: Locator,
	options: {
		testStartTime: number;
		testDurationMs: number;
		screenshotOffsetsMs: number[];
	},
): Promise<{
	x: number;
	y: number;
	displayedTimestamp: number;
	expectedTimestamp: number;
}> {
	return row.evaluate(
		(element, { testStartTime, testDurationMs, screenshotOffsetsMs }) => {
			const timeline = element.closest(
				'[role="region"][aria-label="Trace timeline"]',
			) as HTMLElement | null;
			if (!timeline) {
				throw new Error("Could not find trace timeline region");
			}

			const timelineRect = timeline.getBoundingClientRect();
			const renderedScreenshots = Array.from(
				element.querySelectorAll<HTMLElement>("[data-screenshot-timestamp]"),
			).map((screenshot) => ({
				element: screenshot,
				timestamp: Number(screenshot.dataset.screenshotTimestamp),
				rect: screenshot.getBoundingClientRect(),
			}));
			const renderedTimestamps = new Set(
				renderedScreenshots.map((screenshot) => screenshot.timestamp),
			);

			for (
				let hoverOffsetMs = 0;
				hoverOffsetMs <= testDurationMs;
				hoverOffsetMs += 10
			) {
				const expectedOffsetMs = screenshotOffsetsMs
					.filter((offsetMs) => offsetMs <= hoverOffsetMs)
					.at(-1);
				if (expectedOffsetMs === undefined) continue;
				if (hoverOffsetMs - expectedOffsetMs < 50) continue;

				const expectedTimestamp = testStartTime + expectedOffsetMs;
				if (renderedTimestamps.has(expectedTimestamp)) continue;

				const x =
					timelineRect.left +
					(hoverOffsetMs / testDurationMs) * timelineRect.width;
				const renderedScreenshot = renderedScreenshots.find(
					(screenshot) =>
						x > screenshot.rect.left + 2 && x < screenshot.rect.right - 2,
				);
				if (
					!renderedScreenshot ||
					expectedTimestamp <= renderedScreenshot.timestamp
				) {
					continue;
				}

				return {
					x,
					y: renderedScreenshot.rect.top + renderedScreenshot.rect.height / 2,
					displayedTimestamp: renderedScreenshot.timestamp,
					expectedTimestamp,
				};
			}

			throw new Error(
				"Could not find a hidden screenshot timestamp inside a rendered filmstrip frame",
			);
		},
		options,
	);
}

async function findFilmstripGapHoverTarget(
	row: Locator,
): Promise<{ x: number; y: number }> {
	return row.evaluate((element) => {
		const renderedScreenshots = Array.from(
			element.querySelectorAll<HTMLElement>("[data-screenshot-timestamp]"),
		)
			.map((screenshot) => ({
				rect: screenshot.getBoundingClientRect(),
			}))
			.sort((a, b) => a.rect.left - b.rect.left);

		for (let index = 0; index < renderedScreenshots.length - 1; index++) {
			const left = renderedScreenshots[index].rect.right;
			const right = renderedScreenshots[index + 1].rect.left;
			if (right - left >= 4) {
				return {
					x: left + (right - left) / 2,
					y:
						renderedScreenshots[index].rect.top +
						renderedScreenshots[index].rect.height / 2,
				};
			}
		}

		throw new Error("Could not find a gap between filmstrip screenshots");
	});
}

async function expectDetailsToMatchHoveredScreenshot(
	viewer: TraceViewerPage,
	row: Locator,
): Promise<void> {
	const screenshot = row.locator("[data-screenshot-timestamp]").first();
	const [timestamp, contextId, pageId] = await Promise.all([
		screenshot.getAttribute("data-screenshot-timestamp"),
		screenshot.getAttribute("data-screenshot-context-id"),
		screenshot.getAttribute("data-screenshot-page-id"),
	]);

	if (!timestamp || !contextId || !pageId) {
		throw new Error("Screenshot row is missing screenshot metadata");
	}

	const box = await screenshot.boundingBox();
	if (!box) {
		throw new Error("Screenshot is not visible");
	}
	await screenshot.hover({
		position: { x: Math.max(0, box.width - 2), y: box.height / 2 },
	});
	await expect(viewer.details.screenshot()).toHaveAttribute(
		"data-screenshot-timestamp",
		timestamp,
	);
	await expect(viewer.details.screenshot()).toHaveAttribute(
		"data-screenshot-context-id",
		contextId,
	);
	await expect(viewer.details.screenshot()).toHaveAttribute(
		"data-screenshot-page-id",
		pageId,
	);
}
