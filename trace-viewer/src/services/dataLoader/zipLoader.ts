import type { Entry, FileEntry } from "@zip.js/zip.js";
import { BlobReader, BlobWriter, TextWriter, ZipReader } from "@zip.js/zip.js";
import type { OtlpTraceExport } from "../../types/otel";
import type { LoadProgress, TraceLoaderBackend } from "./types";
import { TRACE_FILE_PATHS } from "./types";

export interface ZipLoadResult {
	/** The parsed OTLP trace data */
	traceData: OtlpTraceExport;
	/** Map of screenshot filename -> blob */
	screenshots: Map<string, Blob>;
	/** List of screenshot filenames in order */
	screenshotFilenames: string[];
}

export interface ZipEntries {
	entries: Map<string, Entry>;
}

export async function loadZipFile(
	zipBlob: Blob,
	onProgress?: LoadProgress,
): Promise<ZipLoadResult> {
	const entries = await extractZipEntries(zipBlob, onProgress);
	return parseZipEntries(entries);
}

export async function extractZipEntries(
	zipBlob: Blob,
	_onProgress?: LoadProgress,
): Promise<ZipEntries> {
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
	const traceJsonEntry = entries.get(TRACE_FILE_PATHS.TRACE_JSON);
	if (!traceJsonEntry) {
		throw new Error(
			`Trace JSON not found at ${TRACE_FILE_PATHS.TRACE_JSON}. ` +
				"Make sure you're loading a valid Playwright OpenTelemetry trace ZIP.",
		);
	}

	const traceJsonText = await readEntryAsText(traceJsonEntry);
	const traceData: OtlpTraceExport = JSON.parse(traceJsonText);

	// Collect screenshots
	const screenshots = new Map<string, Blob>();
	const screenshotFilenames: string[] = [];

	for (const [filename, entry] of entries) {
		if (filename.startsWith(TRACE_FILE_PATHS.SCREENSHOTS_DIR)) {
			const screenshotName = filename.slice(
				TRACE_FILE_PATHS.SCREENSHOTS_DIR.length,
			);
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

export class BlobZipLoaderBackend implements TraceLoaderBackend {
	private entriesPromise: Promise<Map<string, Entry>>;

	constructor(zipBlob: Blob, onProgress?: LoadProgress) {
		this.entriesPromise = extractZipEntries(zipBlob, onProgress).then(
			(result) => result.entries,
		);
	}

	async entryNames(): Promise<string[]> {
		const entries = await this.entriesPromise;
		return [...entries.keys()];
	}

	async hasEntry(entryName: string): Promise<boolean> {
		const entries = await this.entriesPromise;
		return entries.has(entryName);
	}

	async readText(entryName: string): Promise<string | undefined> {
		const entries = await this.entriesPromise;
		const entry = entries.get(entryName);
		if (!entry) return undefined;
		return readEntryAsText(entry);
	}

	async readBlob(entryName: string): Promise<Blob | undefined> {
		const entries = await this.entriesPromise;
		const entry = entries.get(entryName);
		if (!entry) return undefined;
		return readEntryAsBlob(entry, getMimeType(entryName));
	}
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
