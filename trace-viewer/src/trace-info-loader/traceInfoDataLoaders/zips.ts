import type { Entry, FileEntry } from "@zip.js/zip.js";
import { BlobReader, BlobWriter, TextWriter, ZipReader } from "@zip.js/zip.js";
import type { ScreenshotMeta } from "../../service-worker/register";
import type { TestInfo } from "../TraceInfoLoader";

const TEST_JSON_PATH = "test.json";
const OTEL_PROTOCOL_DIR = "opentelemetry-protocol/";
const SCREENSHOTS_DIR = "screenshots/";

/**
 * Trace file with name and parsed JSON content
 */
export interface TraceFile {
	/** Filename (e.g., "playwright-opentelemetry.json") */
	name: string;
	/** Parsed JSON content */
	content: unknown;
}

export interface ZipLoadResult {
	testInfo: TestInfo;
	/** All trace files from opentelemetry-protocol directory */
	traceFiles: TraceFile[];
	/** Screenshots map: filename -> blob */
	screenshots: Map<string, Blob>;
	/** Screenshot metadata for list endpoint */
	screenshotMetas: ScreenshotMeta[];
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

	// Find all JSON files in opentelemetry-protocol directory
	const traceFiles: TraceFile[] = [];
	for (const [filename, entry] of entries) {
		if (
			filename.startsWith(OTEL_PROTOCOL_DIR) &&
			filename.endsWith(".json") &&
			isFileEntry(entry)
		) {
			// Extract just the filename without the directory prefix
			const name = filename.slice(OTEL_PROTOCOL_DIR.length);
			if (name) {
				const text = await readEntryAsText(entry);
				const content = JSON.parse(text);
				traceFiles.push({ name, content });
			}
		}
	}

	if (traceFiles.length === 0) {
		throw new Error(
			`No trace files found in ${OTEL_PROTOCOL_DIR}. ` +
				"Make sure you're loading a valid Playwright OpenTelemetry trace ZIP.",
		);
	}

	// Collect screenshots with their metadata
	const screenshots = new Map<string, Blob>();
	const screenshotMetas: ScreenshotMeta[] = [];

	for (const [filename, entry] of entries) {
		if (filename.startsWith(SCREENSHOTS_DIR) && isFileEntry(entry)) {
			// Extract just the filename without the directory prefix
			const name = filename.slice(SCREENSHOTS_DIR.length);
			if (name) {
				const mimeType = getMimeType(name);
				const blob = await readEntryAsBlob(entry, mimeType);
				screenshots.set(name, blob);

				// Extract timestamp from filename
				const timestamp = extractTimestampFromFilename(name);
				screenshotMetas.push({
					timestamp,
					file: name,
				});
			}
		}
	}

	// Sort screenshots by timestamp
	screenshotMetas.sort((a, b) => a.timestamp - b.timestamp);

	return {
		testInfo,
		traceFiles,
		screenshots,
		screenshotMetas,
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
