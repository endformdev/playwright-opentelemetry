/**
 * LEGACY: reads screenshots out of Playwright's trace.zip, for Playwright
 * older than SCREENCAST_SCREENSHOTS_MIN_PLAYWRIGHT_VERSION. Delete this
 * directory, its tests and the reporter's legacy branch once the peer
 * dependency requires that version.
 */
import fs from "node:fs/promises";
import type { Entry, FileEntry } from "@zip.js/zip.js";
import { BlobReader, BlobWriter, TextWriter, ZipReader } from "@zip.js/zip.js";
import type { ScreenshotResource } from "../../shared/screenshots-zip";

const PLAYWRIGHT_TRACE_RESOURCES_DIR = "resources/";
const PLAYWRIGHT_TRACE_SCREENCAST_DIR = "screencast/";

/**
 * Pattern to match Playwright screenshot filenames: {name}@{hex-hash}-{timestamp}.jpeg
 * Examples: page@f06f11f7c14d6ce1060d47d79f05c154-1766833384425.jpeg
 */
const PLAYWRIGHT_SCREENSHOT_PATTERN = /^.+@[a-f0-9]+-\d+\.jpe?g$/i;

/**
 * Extract screenshots from a Playwright trace ZIP file.
 * Screencast frames are named {pageGuid}-{timestamp}.jpeg
 * (e.g., page@abc123-1766929201038.jpeg) and live in resources/ for
 * Playwright <= 1.62 or screencast/ for Playwright >= 1.63.
 *
 * Never rejects: a trace that can't be read gives no screenshots.
 *
 * @param traceZipPath - Path to the Playwright trace.zip file
 * @returns Map of filename (without directory prefix) to screenshot resources
 */
export async function extractScreenshotsFromPlaywrightTrace(
	traceZipPath: string,
): Promise<Map<string, ScreenshotResource>> {
	const screenshots = new Map<string, ScreenshotResource>();

	try {
		const zipBuffer = await fs.readFile(traceZipPath);
		const zipReader = new ZipReader(new BlobReader(new Blob([zipBuffer])));
		const entries = await zipReader.getEntries();
		const pageIdByPath = await extractScreencastPageIds(entries);

		const screenshotEntries = entries.flatMap((entry) => {
			if (!isFileEntry(entry)) return [];
			const filename = screenshotResourceName(entry.filename);
			return filename ? [{ entry, filename }] : [];
		});

		await Promise.all(
			screenshotEntries.map(async ({ entry, filename }) => {
				const blob = await entry.getData(new BlobWriter("image/jpeg"));
				screenshots.set(filename, {
					blob,
					file: filename,
					timestamp: extractTimestampFromFilename(filename),
					contentType: getMimeType(filename),
					pageId:
						pageIdByPath.get(entry.filename) ??
						extractResourceIdFromFilename(filename),
				});
			}),
		);

		await zipReader.close();
	} catch (err) {
		// A missing trace file just means there are no screenshots.
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			console.warn(
				`Warning: Could not extract screenshots from trace ZIP: ${err}`,
			);
		}
	}

	return screenshots;
}

/**
 * Map screencast frame zip paths to the page that produced them.
 * Playwright <= 1.62 (trace v8) references frames via `sha1` relative to
 * resources/; Playwright >= 1.63 (trace v9+) uses a zip-relative `file` path.
 */
async function extractScreencastPageIds(
	entries: Entry[],
): Promise<Map<string, string>> {
	const pageIdByPath = new Map<string, string>();
	const traceEntries = entries.filter(
		(entry): entry is FileEntry =>
			isFileEntry(entry) && isPlaywrightTraceEntry(entry.filename),
	);

	await Promise.all(
		traceEntries.map(async (entry) => {
			const text = await entry.getData(new TextWriter());

			for (const line of text.split("\n")) {
				if (!line.trim()) continue;
				const event = parseTraceEvent(line);
				if (!event) continue;
				if (event.type !== "screencast-frame") continue;
				if (typeof event.pageId !== "string") continue;

				const screenshotPath =
					typeof event.file === "string"
						? event.file
						: typeof event.sha1 === "string"
							? `${PLAYWRIGHT_TRACE_RESOURCES_DIR}${event.sha1}`
							: null;
				if (screenshotPath) pageIdByPath.set(screenshotPath, event.pageId);
			}
		}),
	);

	return pageIdByPath;
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

function screenshotResourceName(filename: string): string | null {
	const prefix = [
		PLAYWRIGHT_TRACE_RESOURCES_DIR,
		PLAYWRIGHT_TRACE_SCREENCAST_DIR,
	].find((directory) => filename.startsWith(directory));
	if (!prefix) return null;
	const name = filename.slice(prefix.length);
	return PLAYWRIGHT_SCREENSHOT_PATTERN.test(name) ? name : null;
}
