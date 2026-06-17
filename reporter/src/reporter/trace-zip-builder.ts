import fs from "node:fs/promises";
import path from "node:path";
import type { TestCase } from "@playwright/test/reporter";
import type { Entry, FileEntry } from "@zip.js/zip.js";
import {
	BlobReader,
	BlobWriter,
	TextWriter,
	ZipReader,
	ZipWriter,
} from "@zip.js/zip.js";
import type { Span } from "../shared/otel";
import { buildOtlpRequest } from "./sender";

export interface ScreenshotManifestEntry {
	timestamp: number;
	file: string;
	path: string;
	contentType: string;
	contextId: string;
	pageId: string;
}

export interface ScreenshotManifest {
	version: 2;
	screenshots: ScreenshotManifestEntry[];
}

export interface ScreenshotResource {
	timestamp: number;
	file: string;
	contentType: string;
	contextId: string;
	pageId: string;
	blob: Blob;
}

interface ScreenshotTraceMetadata {
	contextId: string;
	pageId: string;
}

/**
 * Get the zip filename based on test location and ID.
 * Format: {basename(file)}:{line}-{testId}-pw-otel.zip
 * Fallback: {testId}-pw-otel.zip (if no location info)
 */
export function getZipFilename(test: TestCase, testId: string): string {
	if (test.location) {
		const basename = path.basename(test.location.file);
		return `${basename}:${test.location.line}-${testId}-pw-otel.zip`;
	}
	return `${testId}-pw-otel.zip`;
}

const PLAYWRIGHT_TRACE_RESOURCES_DIR = "resources/";

/**
 * Pattern to match Playwright screenshot filenames: {name}@{hex-hash}-{timestamp}.jpeg
 * Examples: page@f06f11f7c14d6ce1060d47d79f05c154-1766833384425.jpeg
 */
const PLAYWRIGHT_SCREENSHOT_PATTERN = /^.+@[a-f0-9]+-\d+\.jpe?g$/i;

/**
 * Extract screenshots from a Playwright trace ZIP file.
 * Screenshots are stored in the resources/ directory with names like:
 * {pageGuid}-{timestamp}.jpeg (e.g., page@abc123-1766929201038.jpeg)
 *
 * @param traceZipPath - Path to the Playwright trace.zip file
 * @returns Map of filename (without resources/ prefix) to screenshot resources
 */
export async function extractScreenshotsFromPlaywrightTrace(
	traceZipPath: string,
): Promise<Map<string, ScreenshotResource>> {
	const screenshots = new Map<string, ScreenshotResource>();

	try {
		// Read the trace ZIP file
		const zipBuffer = await fs.readFile(traceZipPath);
		const zipBlob = new Blob([zipBuffer]);

		// Open the ZIP and get entries
		const zipReader = new ZipReader(new BlobReader(zipBlob));
		const entries = await zipReader.getEntries();
		const screenshotMetadata = await extractScreenshotTraceMetadata(entries);

		// Extract screenshot files from resources/ directory
		// Process concurrently for efficiency
		await Promise.all(
			entries
				.filter((entry): entry is FileEntry => {
					if (!isFileEntry(entry)) return false;
					if (!entry.filename.startsWith(PLAYWRIGHT_TRACE_RESOURCES_DIR))
						return false;
					const name = entry.filename.slice(
						PLAYWRIGHT_TRACE_RESOURCES_DIR.length,
					);
					return PLAYWRIGHT_SCREENSHOT_PATTERN.test(name);
				})
				.map(async (entry) => {
					const filename = entry.filename.slice(
						PLAYWRIGHT_TRACE_RESOURCES_DIR.length,
					);
					const blob = await entry.getData(new BlobWriter("image/jpeg"));
					const metadata = screenshotMetadata.get(filename);
					screenshots.set(filename, {
						blob,
						file: filename,
						timestamp: extractTimestampFromFilename(filename),
						contentType: getMimeType(filename),
						contextId: metadata?.contextId ?? "unknown-context",
						pageId: metadata?.pageId ?? extractResourceIdFromFilename(filename),
					});
				}),
		);

		await zipReader.close();
	} catch (err) {
		// If file doesn't exist or can't be read, return empty map
		// This allows tests without tracing enabled to still work
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			console.warn(
				`Warning: Could not extract screenshots from trace ZIP: ${err}`,
			);
		}
	}

	return screenshots;
}

export async function createScreenshotsZip(
	screenshots: Map<string, ScreenshotResource>,
): Promise<Blob> {
	const blobWriter = new BlobWriter("application/zip");
	const zipWriter = new ZipWriter(blobWriter);

	await addScreenshotsToZip(zipWriter, screenshots);

	return zipWriter.close();
}

export interface CreateTraceZipOptions {
	outputDir: string;
	test: TestCase;
	spans: Span[];
	fixtureSpans: Span[];
	serviceName: string;
	playwrightVersion: string;
	/** Screenshots extracted from Playwright trace ZIP (filename -> resource) */
	screenshots: Map<string, ScreenshotResource>;
}

export type CreateTraceZipBlobOptions = Omit<
	CreateTraceZipOptions,
	"outputDir"
>;

/**
 * Create a zip file containing the OTLP trace JSON and screenshots for a test.
 */
export async function createTraceZip(
	options: CreateTraceZipOptions,
): Promise<void> {
	const zipBlob = await createTraceZipBlob(options);
	await writeTraceZip(options.outputDir, options.test, zipBlob);
}

export async function createTraceZipBlob(
	options: CreateTraceZipBlobOptions,
): Promise<Blob> {
	const { spans, fixtureSpans, serviceName, playwrightVersion, screenshots } =
		options;

	// Build OTLP request JSON
	const otlpRequest = buildOtlpRequest(spans, serviceName, playwrightVersion);
	const traceJson = JSON.stringify(otlpRequest, null, 2);

	// Create zip file
	const blobWriter = new BlobWriter("application/zip");
	const zipWriter = new ZipWriter(blobWriter);

	// Add trace JSON first
	await zipWriter.add(
		"traces/playwright-opentelemetry.json",
		new Blob([traceJson]).stream(),
	);

	if (fixtureSpans.length > 0) {
		const fixtureOtlpRequest = buildOtlpRequest(
			fixtureSpans,
			"playwright-browser",
			playwrightVersion,
		);
		await zipWriter.add(
			"traces/playwright-browser.json",
			new Blob([JSON.stringify(fixtureOtlpRequest, null, 2)]).stream(),
		);
	}

	await addScreenshotsToZip(zipWriter, screenshots);

	return zipWriter.close();
}

export async function writeTraceZip(
	outputDir: string,
	test: TestCase,
	zipBlob: Blob,
): Promise<void> {
	const zipFilename = getZipFilename(test, test.id);
	const zipPath = path.join(outputDir, zipFilename);

	const arrayBuffer = await zipBlob.arrayBuffer();
	await fs.writeFile(zipPath, Buffer.from(arrayBuffer));
}

async function addScreenshotsToZip(
	zipWriter: ZipWriter<Blob>,
	screenshots: Map<string, ScreenshotResource>,
): Promise<void> {
	const manifest = createScreenshotManifest(screenshots);
	await zipWriter.add(
		"manifest.json",
		new Blob([JSON.stringify(manifest, null, 2)], {
			type: "application/json",
		}).stream(),
	);

	for (const [filename, screenshot] of screenshots.entries()) {
		await zipWriter.add(`screenshots/${filename}`, screenshot.blob.stream());
	}
}

function createScreenshotManifest(
	screenshots: Map<string, ScreenshotResource>,
): ScreenshotManifest {
	const entries = Array.from(screenshots.values())
		.map((screenshot) => ({
			timestamp: screenshot.timestamp,
			file: screenshot.file,
			path: `screenshots/${screenshot.file}`,
			contentType: screenshot.contentType,
			contextId: screenshot.contextId,
			pageId: screenshot.pageId,
		}))
		.sort((a, b) => a.timestamp - b.timestamp);

	return {
		version: 2,
		screenshots: entries,
	};
}

async function extractScreenshotTraceMetadata(
	entries: Entry[],
): Promise<Map<string, ScreenshotTraceMetadata>> {
	const metadata = new Map<string, ScreenshotTraceMetadata>();
	const traceEntries = entries.filter(
		(entry): entry is FileEntry =>
			isFileEntry(entry) && isPlaywrightTraceEntry(entry.filename),
	);

	await Promise.all(
		traceEntries.map(async (entry) => {
			const text = await entry.getData(new TextWriter());
			let contextId = "unknown-context";

			for (const line of text.split("\n")) {
				if (!line.trim()) continue;
				const event = parseTraceEvent(line);
				if (!event) continue;

				if (event.type === "context-options" && typeof event.contextId === "string") {
					contextId = event.contextId;
					continue;
				}

				if (
					event.type === "screencast-frame" &&
					typeof event.sha1 === "string" &&
					typeof event.pageId === "string"
				) {
					metadata.set(event.sha1, {
						contextId,
						pageId: event.pageId,
					});
				}
			}
		}),
	);

	return metadata;
}

function isPlaywrightTraceEntry(filename: string): boolean {
	return filename === "trace.trace" || filename.endsWith("-trace.trace");
}

function parseTraceEvent(line: string): Record<string, unknown> | undefined {
	try {
		const value = JSON.parse(line) as unknown;
		return typeof value === "object" && value !== null
			? (value as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function extractTimestampFromFilename(filename: string): number {
	const lastDashIndex = filename.lastIndexOf("-");
	if (lastDashIndex === -1) return 0;

	const timestamp = Number.parseInt(
		filename.slice(lastDashIndex + 1).replace(/\.[^.]+$/, ""),
		10,
	);
	return Number.isNaN(timestamp) ? 0 : timestamp;
}

function extractResourceIdFromFilename(filename: string): string {
	const lastDashIndex = filename.lastIndexOf("-");
	if (lastDashIndex === -1) return "unknown-page";
	return filename.slice(0, lastDashIndex) || "unknown-page";
}

function getMimeType(filename: string): string {
	const ext = filename.split(".").pop()?.toLowerCase();
	switch (ext) {
		case "png":
			return "image/png";
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "webp":
			return "image/webp";
		default:
			return "application/octet-stream";
	}
}

function isFileEntry(entry: Entry): entry is FileEntry {
	return !entry.directory;
}
