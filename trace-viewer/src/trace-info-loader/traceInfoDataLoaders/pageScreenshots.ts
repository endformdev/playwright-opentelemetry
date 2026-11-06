import {
	extractScreenshots,
	loadScreenshotMetas,
} from "../../service-worker/screenshotZip";
import type { ScreenshotInfo } from "../TraceInfoLoader";

/** Blob URLs of the trace on show, kept until the next one replaces them. */
let screenshotUrls: string[] = [];
/** Counts loads and unloads, so a slower, older load doesn't get to publish. */
let loadGeneration = 0;

/**
 * Loads a trace's screenshots without a service worker: the page downloads and
 * unpacks the ZIP itself, and hands out blob URLs.
 *
 * Nothing can intercept a blob URL to extract an image on demand, so all of
 * them are extracted here. The ZIP can go afterwards, so this keeps about as
 * much in memory as the service worker does by holding on to the ZIP.
 */
export async function loadScreenshotsInPage(
	screenshotsZipUrl: string,
): Promise<ScreenshotInfo[]> {
	const generation = ++loadGeneration;

	const response = await fetch(screenshotsZipUrl);
	if (response.status === 404) {
		publishScreenshotUrls(generation, []);
		return [];
	}
	if (!response.ok) {
		// The URL isn't in this message because it can carry a trace token.
		throw new Error(`Failed to fetch screenshots ZIP: ${response.status}`);
	}

	const zip = await response.blob();
	const screenshotMetas = await loadScreenshotMetas(zip);
	const blobs = await extractScreenshots(zip, screenshotMetas);
	if (generation !== loadGeneration) return [];

	const screenshots = screenshotMetas.flatMap((screenshot) => {
		const blob = blobs.get(screenshot.file);
		if (!blob) return [];
		return {
			timestamp: screenshot.timestamp,
			url: URL.createObjectURL(blob),
			pageId: screenshot.pageId,
		};
	});
	publishScreenshotUrls(
		generation,
		screenshots.map((screenshot) => screenshot.url),
	);
	return screenshots;
}

/** Revokes the current blob URLs and abandons any load still in progress. */
export function unloadPageScreenshots(): void {
	loadGeneration += 1;
	revokeScreenshotUrls();
}

function publishScreenshotUrls(generation: number, urls: string[]): void {
	if (generation !== loadGeneration) return;
	revokeScreenshotUrls();
	screenshotUrls = urls;
}

function revokeScreenshotUrls(): void {
	for (const url of screenshotUrls) {
		URL.revokeObjectURL(url);
	}
	screenshotUrls = [];
}
