import type { Entry, FileEntry } from "@zip.js/zip.js";
import { BlobReader, BlobWriter, TextWriter, ZipReader } from "@zip.js/zip.js";
import type { OtlpTraceExport } from "../../types/otel";

const TRACE_JSON_PATH = "opentelemetry-protocol/playwright-opentelemetry.json";
const SCREENSHOTS_DIR = "screenshots";

export interface ZipLoadResult {
	traceData: OtlpTraceExport;
	screenshots: Map<string, Blob>;
	screenshotFilenames: string[];
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

	// Collect screenshots
	const screenshots = new Map<string, Blob>();
	const screenshotFilenames: string[] = [];

	for (const [filename, entry] of entries) {
		if (filename.startsWith(SCREENSHOTS_DIR)) {
			const screenshotName = filename.slice(SCREENSHOTS_DIR.length);
			if (screenshotName && isFileEntry(entry)) {
				const mimeType = getMimeType(screenshotName);
				const blob = await readEntryAsBlob(entry, mimeType);
				screenshots.set(screenshotName, blob);
				screenshotFilenames.push(screenshotName);
			}
		}
	}

	// Sort screenshots by filename (they typically have timestamp-based names)
	screenshotFilenames.sort();

	return {
		traceData,
		screenshots,
		screenshotFilenames,
	};
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
