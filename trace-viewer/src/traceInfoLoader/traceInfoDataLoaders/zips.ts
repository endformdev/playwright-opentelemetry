import type { Entry, FileEntry } from "@zip.js/zip.js";
import { BlobReader, BlobWriter, TextWriter, ZipReader } from "@zip.js/zip.js";
import type { OtlpTraceExport } from "../../types/otel";
import type { ScreenshotInfo, TestInfo } from "../TraceInfoLoader";

const TEST_JSON_PATH = "test.json";
const TRACE_JSON_PATH = "opentelemetry-protocol/playwright-opentelemetry.json";
const SCREENSHOTS_DIR = "screenshots";

export interface ZipLoadResult {
	testInfo: TestInfo;
	traceData: OtlpTraceExport;
	screenshots: Map<string, Blob>;
	screenshotInfos: ScreenshotInfo[];
}

export interface ZipEntries {
	entries: Map<string, Entry>;
}

export async function loadZipFile(zipBlob: Blob): Promise<ZipLoadResult> {
	const entries = await extractZipEntries(zipBlob);
	return parseZipEntries(entries);
}

export async function extractZipEntries(zipBlob: Blob): Promise<ZipEntries> {
	const zipReader = new ZipReader(new BlobReader(zipBlob));

	const rawEntries = await zipReader.getEntries();

	const entries = new Map<string, Entry>();
	for (const entry of rawEntries) {
		entries.set(entry.filename, entry);
	}

	return { entries };
}

async function readEntryAsText(entry: Entry): Promise<string> {
	if (!isFileEntry(entry)) {
		throw new Error(`Cannot read directory entry: ${entry.filename}`);
	}
	const writer = new TextWriter();
	return entry.getData(writer);
}

async function readEntryAsBlob(entry: Entry, mimeType: string): Promise<Blob> {
	if (!isFileEntry(entry)) {
		throw new Error(`Cannot read directory entry: ${entry.filename}`);
	}
	const writer = new BlobWriter(mimeType);
	return entry.getData(writer);
}

export async function parseZipEntries(
	zipEntries: ZipEntries,
): Promise<ZipLoadResult> {
	const { entries } = zipEntries;

	// Find and parse test.json
	const testJsonEntry = entries.get(TEST_JSON_PATH);
	if (!testJsonEntry) {
		throw new Error(
			`Test info not found at ${TEST_JSON_PATH}. ` +
				"Make sure you're loading a valid Playwright OpenTelemetry trace ZIP.",
		);
	}

	const testJsonText = await readEntryAsText(testJsonEntry);
	const testInfo: TestInfo = JSON.parse(testJsonText);

	// Find and parse trace JSON
	const traceJsonEntry = entries.get(TRACE_JSON_PATH);
	if (!traceJsonEntry) {
		throw new Error(
			`Trace JSON not found at ${TRACE_JSON_PATH}. ` +
				"Make sure you're loading a valid Playwright OpenTelemetry trace ZIP.",
		);
	}

	const traceJsonText = await readEntryAsText(traceJsonEntry);
	const traceData: OtlpTraceExport = JSON.parse(traceJsonText);

	// Collect screenshots with their timestamps
	const screenshots = new Map<string, Blob>();
	const screenshotInfos: ScreenshotInfo[] = [];

	for (const [filename, entry] of entries) {
		if (filename.startsWith(SCREENSHOTS_DIR)) {
			// Remove the "screenshots/" prefix, keeping the leading slash for now
			const screenshotName = filename.slice(SCREENSHOTS_DIR.length);
			if (screenshotName && isFileEntry(entry)) {
				// Remove leading slash if present
				const cleanName = screenshotName.startsWith("/")
					? screenshotName.slice(1)
					: screenshotName;

				const mimeType = getMimeType(cleanName);
				const blob = await readEntryAsBlob(entry, mimeType);
				screenshots.set(cleanName, blob);

				// Extract timestamp from filename
				// Format: {pageGuid}-{timestamp}.jpeg (e.g., page@abc123-1766929201038.jpeg)
				const timestamp = extractTimestampFromFilename(cleanName);

				screenshotInfos.push({
					timestamp,
					url: "", // URL will be set by the loader after service worker registration
				});
			}
		}
	}

	// Sort screenshots by timestamp
	screenshotInfos.sort((a, b) => a.timestamp - b.timestamp);

	return {
		testInfo,
		traceData,
		screenshots,
		screenshotInfos,
	};
}

/**
 * Extract timestamp from screenshot filename.
 * Format: {pageGuid}-{timestamp}.jpeg (e.g., page@abc123-1766929201038.jpeg)
 */
function extractTimestampFromFilename(filename: string): number {
	// Find the last dash before the extension
	const lastDashIndex = filename.lastIndexOf("-");
	if (lastDashIndex === -1) {
		return 0;
	}

	const afterDash = filename.slice(lastDashIndex + 1);
	// Remove extension
	const timestampStr = afterDash.replace(/\.[^.]+$/, "");
	const timestamp = parseInt(timestampStr, 10);

	return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getMimeType(filename: string): string {
	const ext = filename.split(".").pop()?.toLowerCase();
	switch (ext) {
		case "json":
			return "application/json";
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
