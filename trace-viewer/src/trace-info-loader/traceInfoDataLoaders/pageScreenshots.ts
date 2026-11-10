import type { ScreenshotInfo } from "../TraceInfoLoader";

/** Which of the traces on show: the viewer's own, or one compared with it. */
export type TraceSlot = "primary" | "comparison";

interface SlotState {
	/** Blob URLs of the slot's trace, kept until the next one replaces them */
	screenshotUrls: string[];
	/** Counts loads and unloads, so a slower, older load doesn't get to publish */
	loadGeneration: number;
}

const slots: Record<TraceSlot, SlotState> = {
	primary: { screenshotUrls: [], loadGeneration: 0 },
	comparison: { screenshotUrls: [], loadGeneration: 0 },
};

/**
 * Loads a trace's screenshots without a service worker: the page downloads and
 * unpacks the ZIP itself, and hands out blob URLs.
 *
 * Nothing can intercept a blob URL to extract an image on demand, so all of
 * them are extracted here. That takes longer and uses more memory than the
 * service worker does by holding on to the ZIP.
 *
 * Each slot keeps its own URLs, so loading a comparison leaves the primary's
 * images alone.
 */
export async function loadScreenshotsInPage(
	screenshotsZipUrl: string,
	slot: TraceSlot,
): Promise<ScreenshotInfo[]> {
	const state = slots[slot];
	const generation = ++state.loadGeneration;

	const response = await fetch(screenshotsZipUrl);
	if (response.status === 404) {
		publishScreenshotUrls(state, generation, []);
		return [];
	}
	if (!response.ok) {
		// The URL isn't in this message because it can carry a trace token.
		throw new Error(`Failed to fetch screenshots ZIP: ${response.status}`);
	}

	// Only this path needs the ZIP code in the page: the service worker has its
	// own copy. The download carries on while this chunk loads.
	const { extractScreenshots, loadScreenshotMetas } =
		await import("../../service-worker/screenshotZip");
	const zip = await response.blob();
	const screenshotMetas = await loadScreenshotMetas(zip);
	const blobs = await extractScreenshots(zip, screenshotMetas);
	if (generation !== state.loadGeneration) return [];

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
		state,
		generation,
		screenshots.map((screenshot) => screenshot.url),
	);
	return screenshots;
}

/**
 * Revokes a slot's blob URLs and abandons any load still in progress for it;
 * with no slot, both slots'.
 */
export function unloadPageScreenshots(slot?: TraceSlot): void {
	for (const state of slot ? [slots[slot]] : Object.values(slots)) {
		state.loadGeneration += 1;
		revokeScreenshotUrls(state);
	}
}

function publishScreenshotUrls(
	state: SlotState,
	generation: number,
	urls: string[],
): void {
	if (generation !== state.loadGeneration) return;
	revokeScreenshotUrls(state);
	state.screenshotUrls = urls;
}

function revokeScreenshotUrls(state: SlotState): void {
	for (const url of state.screenshotUrls) {
		URL.revokeObjectURL(url);
	}
	state.screenshotUrls = [];
}
