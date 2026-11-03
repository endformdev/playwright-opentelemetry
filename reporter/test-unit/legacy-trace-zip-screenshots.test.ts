/**
 * LEGACY: reading screenshots from Playwright's trace.zip, for Playwright
 * versions whose screencast the fixture doesn't use and for the reporter
 * running without the fixture. Delete with src/reporter/legacy/.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { BlobWriter, ZipWriter } from "@zip.js/zip.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractScreenshotsFromPlaywrightTrace } from "../src/reporter/legacy/trace-zip-screenshots";
import type { PlaywrightOpentelemetryConfig } from "../src/shared/config";
import {
	createScreenshotsZip,
	readScreenshotsZip,
	SCREENSHOTS_ATTACHMENT_NAME,
} from "../src/shared/screenshots-zip";
import { runReporterTest } from "./reporter-harness";

function createTestOutputDir(testName: string): string {
	const outputDir = `/tmp/legacy-trace-zip-test-${testName}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	mkdirSync(outputDir, { recursive: true });
	return outputDir;
}

function createMinimalJpeg(): Buffer {
	return Buffer.from([
		0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
		0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
	]);
}

/**
 * Creates a mock Playwright trace ZIP file with screenshots in resources/ directory.
 * This simulates what Playwright creates when tracing is enabled.
 *
 * Playwright trace ZIP structure:
 * trace.zip/
 * ├── trace.trace          # JSON lines of trace events
 * └── resources/
 *     ├── {pageGuid}-{timestamp}.jpeg   # Screenshot frames
 *     └── ...
 *
 * @param outputDir - Directory to write the trace ZIP to
 * @param screenshots - Array of screenshot info with pageGuid and timestamp
 * @returns Path to the created trace ZIP file
 */
async function createMockPlaywrightTraceZip(
	outputDir: string,
	screenshots: Array<{
		pageGuid: string;
		timestamp: number;
		/** Which browser context (and therefore which N-trace.trace file) the frame belongs to. */
		context?: string;
		pageId?: string;
	}>,
): Promise<string> {
	const traceZipPath = path.join(outputDir, "trace.zip");

	const blobWriter = new BlobWriter("application/zip");
	const zipWriter = new ZipWriter(blobWriter);

	const screenshotsByContext = new Map<
		string,
		Array<{ pageGuid: string; timestamp: number; pageId: string }>
	>();
	for (const screenshot of screenshots) {
		const context = screenshot.context ?? "default";
		const contextScreenshots = screenshotsByContext.get(context) ?? [];
		contextScreenshots.push({
			pageGuid: screenshot.pageGuid,
			timestamp: screenshot.timestamp,
			pageId: screenshot.pageId ?? screenshot.pageGuid,
		});
		screenshotsByContext.set(context, contextScreenshots);
	}

	let contextIndex = 0;
	for (const contextScreenshots of screenshotsByContext.values()) {
		const traceEvents = [
			{
				version: 8,
				type: "context-options",
				origin: "library",
			},
			...contextScreenshots.map((screenshot) => ({
				type: "screencast-frame",
				pageId: screenshot.pageId,
				sha1: `${screenshot.pageGuid}-${screenshot.timestamp}.jpeg`,
				timestamp: screenshot.timestamp,
				frameSwapWallTime: screenshot.timestamp,
			})),
		]
			.map((event) => JSON.stringify(event))
			.join("\n");
		await zipWriter.add(
			`${contextIndex}-trace.trace`,
			new Blob([traceEvents]).stream() as ReadableStream,
		);
		contextIndex += 1;
	}

	// Add screenshots to resources/ directory
	const jpegBuffer = createMinimalJpeg();
	for (const { pageGuid, timestamp } of screenshots) {
		const filename = `resources/${pageGuid}-${timestamp}.jpeg`;
		await zipWriter.add(
			filename,
			new Blob([new Uint8Array(jpegBuffer)]).stream() as ReadableStream,
		);
	}

	const zipBlob = await zipWriter.close();
	const arrayBuffer = await zipBlob.arrayBuffer();
	await fs.writeFile(traceZipPath, Buffer.from(arrayBuffer));

	return traceZipPath;
}

describe("extractScreenshotsFromPlaywrightTrace", () => {
	let outputDir: string;

	afterEach(async () => {
		if (outputDir && existsSync(outputDir)) {
			rmSync(outputDir, { recursive: true, force: true });
		}
	});

	/**
	 * Creates a mock trace ZIP with arbitrary files in resources/
	 */
	async function createTraceZipWithResources(
		files: Array<{ filename: string; content: Buffer }>,
	): Promise<string> {
		outputDir = `/tmp/trace-extract-test-${Date.now()}`;
		mkdirSync(outputDir, { recursive: true });

		const traceZipPath = path.join(outputDir, "trace.zip");
		const blobWriter = new BlobWriter("application/zip");
		const zipWriter = new ZipWriter(blobWriter);

		// Add trace.trace file
		await zipWriter.add(
			"trace.trace",
			new Blob([JSON.stringify({ name: "trace" })]).stream() as ReadableStream,
		);

		// Add all specified files
		for (const { filename, content } of files) {
			await zipWriter.add(
				filename,
				new Blob([new Uint8Array(content)]).stream() as ReadableStream,
			);
		}

		const zipBlob = await zipWriter.close();
		await fs.writeFile(traceZipPath, Buffer.from(await zipBlob.arrayBuffer()));

		return traceZipPath;
	}

	const minimalJpeg = Buffer.from([
		0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
		0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
	]);

	it("extracts screenshots matching page@{hash}-{timestamp}.jpeg pattern", async () => {
		const traceZipPath = await createTraceZipWithResources([
			{
				filename:
					"resources/page@f06f11f7c14d6ce1060d47d79f05c154-1766833384425.jpeg",
				content: minimalJpeg,
			},
			{
				filename: "resources/page@abc123-999999.jpeg",
				content: minimalJpeg,
			},
		]);

		const screenshots =
			await extractScreenshotsFromPlaywrightTrace(traceZipPath);

		expect(screenshots.size).toBe(2);
		expect(
			screenshots.has(
				"page@f06f11f7c14d6ce1060d47d79f05c154-1766833384425.jpeg",
			),
		).toBe(true);
		expect(screenshots.has("page@abc123-999999.jpeg")).toBe(true);
	});

	it("extracts Playwright 1.63 screencast files referenced by zip-relative path", async () => {
		const filenames = [
			"page@abc123-1789891675551.jpeg",
			"page@def456-1789891676408.jpeg",
		];
		const files = filenames.flatMap((filename, index) => [
			{ filename: `screencast/${filename}`, content: minimalJpeg },
			{
				filename: `${index}-trace.trace`,
				content: Buffer.from(
					[
						{ version: 9, type: "context-options", origin: "library" },
						{
							type: "screencast-frame",
							file: `screencast/${filename}`,
							pageId: `page-${index}`,
							timestamp: 100 + index,
						},
					]
						.map((event) => JSON.stringify(event))
						.join("\n"),
				),
			},
		]);
		const traceZipPath = await createTraceZipWithResources(files);
		const screenshots =
			await extractScreenshotsFromPlaywrightTrace(traceZipPath);
		expect(screenshots.size).toBe(2);
		for (const [index, filename] of filenames.entries()) {
			const screenshot = screenshots.get(filename)!;
			expect(screenshot).toMatchObject({
				file: filename,
				pageId: `page-${index}`,
				contentType: "image/jpeg",
			});
			expect(Buffer.from(await screenshot.blob.arrayBuffer())).toEqual(
				minimalJpeg,
			);
		}
		expect(screenshots.get(filenames[0]!)!.timestamp).toBe(1789891675551);
		expect(screenshots.get(filenames[1]!)!.timestamp).toBe(1789891676408);
	});

	it("attributes pre-1.63 sha1-referenced frames to pages across multiple contexts", async () => {
		outputDir = createTestOutputDir("extract-multi-context-screenshots");
		const firstPageId = "page@111aaa";
		const secondPageId = "page@222bbb";

		const traceZipPath = await createMockPlaywrightTraceZip(outputDir, [
			{
				pageGuid: firstPageId,
				context: "first",
				timestamp: 1766833384425,
			},
			{
				pageGuid: secondPageId,
				context: "second",
				timestamp: 1766833384525,
			},
			{
				pageGuid: secondPageId,
				context: "second",
				timestamp: 1766833384625,
			},
		]);

		const screenshots =
			await extractScreenshotsFromPlaywrightTrace(traceZipPath);

		expect(screenshots.size).toBe(3);
		expect(screenshots.get(`${firstPageId}-1766833384425.jpeg`)).toMatchObject({
			pageId: firstPageId,
			timestamp: 1766833384425,
		});
		expect(screenshots.get(`${secondPageId}-1766833384525.jpeg`)).toMatchObject(
			{
				pageId: secondPageId,
				timestamp: 1766833384525,
			},
		);
	});

	it("extracts screenshots with different prefixes (frame@, element@, etc.)", async () => {
		const traceZipPath = await createTraceZipWithResources([
			{
				filename: "resources/frame@deadbeef-123456.jpeg",
				content: minimalJpeg,
			},
			{
				filename: "resources/element@cafebabe-789012.jpeg",
				content: minimalJpeg,
			},
			{
				filename: "resources/MyCustomThing@abcd1234-555555.jpeg",
				content: minimalJpeg,
			},
		]);

		const screenshots =
			await extractScreenshotsFromPlaywrightTrace(traceZipPath);

		expect(screenshots.size).toBe(3);
		expect(screenshots.has("frame@deadbeef-123456.jpeg")).toBe(true);
		expect(screenshots.has("element@cafebabe-789012.jpeg")).toBe(true);
		expect(screenshots.has("MyCustomThing@abcd1234-555555.jpeg")).toBe(true);
	});

	it("ignores static assets that don't match the screenshot pattern", async () => {
		const traceZipPath = await createTraceZipWithResources([
			// Valid screenshot - should be included
			{
				filename:
					"resources/page@f06f11f7c14d6ce1060d47d79f05c154-1766833384425.jpeg",
				content: minimalJpeg,
			},
			// Static assets - should be ignored
			{ filename: "resources/logo.jpeg", content: minimalJpeg },
			{ filename: "resources/banner.jpg", content: minimalJpeg },
			{ filename: "resources/thumbnail-123.jpeg", content: minimalJpeg },
			{ filename: "resources/image-abc.jpg", content: minimalJpeg },
			// Missing @ symbol
			{ filename: "resources/page-123456.jpeg", content: minimalJpeg },
			// Missing timestamp after dash
			{ filename: "resources/page@abc123.jpeg", content: minimalJpeg },
			// Non-hex hash (has 'g' which is not hex)
			{ filename: "resources/page@ghijklmn-123456.jpeg", content: minimalJpeg },
		]);

		const screenshots =
			await extractScreenshotsFromPlaywrightTrace(traceZipPath);

		expect(screenshots.size).toBe(1);
		expect(
			screenshots.has(
				"page@f06f11f7c14d6ce1060d47d79f05c154-1766833384425.jpeg",
			),
		).toBe(true);
	});

	it("ignores non-jpeg files even if they match the naming pattern", async () => {
		const traceZipPath = await createTraceZipWithResources([
			{
				filename: "resources/page@abc123-123456.jpeg",
				content: minimalJpeg,
			},
			// These should be ignored - wrong extension
			{ filename: "resources/page@abc123-123456.png", content: minimalJpeg },
			{ filename: "resources/page@abc123-123456.webp", content: minimalJpeg },
			{ filename: "resources/page@abc123-123456.gif", content: minimalJpeg },
		]);

		const screenshots =
			await extractScreenshotsFromPlaywrightTrace(traceZipPath);

		expect(screenshots.size).toBe(1);
		expect(screenshots.has("page@abc123-123456.jpeg")).toBe(true);
	});
});

describe("reporter screenshot fallback to Playwright's trace", () => {
	const mockFetch = vi.fn();
	const traceApiConfig: PlaywrightOpentelemetryConfig = {
		playwrightTraceApiEndpoint: { url: "https://traces.example.com" },
	};
	let outputDir: string;

	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = mockFetch;
		mockFetch.mockResolvedValue({ ok: true, status: 200 });
		outputDir = createTestOutputDir("fallback");
	});

	afterEach(() => {
		rmSync(outputDir, { recursive: true, force: true });
	});

	async function uploadedScreenshots(options: {
		playwrightOpentelemetry?: PlaywrightOpentelemetryConfig;
		withFixtureScreenshots?: boolean;
	}) {
		const traceZipPath = await createMockPlaywrightTraceZip(outputDir, [
			{ pageGuid: "page@aaa111", timestamp: 1000 },
		]);
		const attachments = [
			{ name: "trace", contentType: "application/zip", path: traceZipPath },
		];
		if (options.withFixtureScreenshots) {
			const screenshotsZipPath = path.join(outputDir, "screenshots.zip");
			const zip = await createScreenshotsZip([
				{
					pageId: "page-0",
					timestamp: 2000,
					file: "page-0-2000.jpeg",
					contentType: "image/jpeg",
					blob: new Blob([new Uint8Array(createMinimalJpeg())]),
				},
			]);
			await fs.writeFile(
				screenshotsZipPath,
				Buffer.from(await zip.arrayBuffer()),
			);
			attachments.push({
				name: SCREENSHOTS_ATTACHMENT_NAME,
				contentType: "application/zip",
				path: screenshotsZipPath,
			});
		}

		await runReporterTest({
			playwrightOpentelemetry: {
				...traceApiConfig,
				...options.playwrightOpentelemetry,
			},
			test: { title: "fallback test" },
			result: { attachments },
		});

		const call = mockFetch.mock.calls.find(
			(call) =>
				call[0] ===
				"https://traces.example.com/playwright-otel-reporter/v1/screenshots.zip",
		);
		if (!call) {
			throw new Error("Expected trace API screenshots request");
		}
		return readScreenshotsZip(call[1].body);
	}

	it("reads screenshots from the trace when the fixture attached none", async () => {
		expect(await uploadedScreenshots({})).toEqual([
			expect.objectContaining({
				pageId: "page@aaa111",
				timestamp: 1000,
				file: "page@aaa111-1000.jpeg",
			}),
		]);
	});

	it("prefers the fixture's screenshots over the trace's", async () => {
		expect(await uploadedScreenshots({ withFixtureScreenshots: true })).toEqual(
			[expect.objectContaining({ pageId: "page-0", timestamp: 2000 })],
		);
	});

	it("reads no screenshots from the trace when screenshots are off", async () => {
		expect(
			await uploadedScreenshots({
				playwrightOpentelemetry: { screenshots: false },
			}),
		).toEqual([]);
	});
});
