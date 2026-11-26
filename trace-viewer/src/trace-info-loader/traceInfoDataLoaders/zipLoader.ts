import {
	getTraceViewerApiUrl,
	loadScreenshotsForTraceInServiceWorker,
	loadScreenshotsZipInServiceWorker,
	loadTraceInServiceWorker,
	loadTraceZipUrlInServiceWorker,
	registerServiceWorker,
	unloadTraceFromServiceWorker,
} from "../../service-worker/register";
import type { ScreenshotMeta } from "../../service-worker/screenshotZip";
import type {
	ScreenshotInfo,
	TraceAction,
	TraceInfoData,
} from "../TraceInfoLoader";
import { deriveTestInfoFromOtlpExport } from "../deriveTestInfo";
import { type TraceSlot, unloadPageScreenshots } from "./pageScreenshots";

let swRegistrationPromise: Promise<ServiceWorkerRegistration> | null = null;
let localZipSourceCounter = 0;

export async function loadLocalZip(file: File): Promise<TraceInfoData> {
	await ensureServiceWorker();
	await unloadTrace("primary");

	return loadZipBlob(file);
}

/**
 * A comparison leaves the primary loaded: the service worker serves both, as
 * their screenshot URLs name the ZIP they come from.
 */
export async function loadRemoteZip(
	url: string,
	slot: TraceSlot,
): Promise<TraceInfoData> {
	await ensureServiceWorker();
	await unloadTrace(slot);

	const loadedTrace = await loadTraceZipUrlInServiceWorker({ zipUrl: url });
	return traceInfoFromLoadedTrace(loadedTrace, { traceZip: url });
}

async function loadZipBlob(zip: Blob): Promise<TraceInfoData> {
	const sourceId = createLocalZipSourceId();
	const loadedTrace = await loadTraceInServiceWorker({ zip, sourceId });
	return traceInfoFromLoadedTrace(loadedTrace, { traceSource: sourceId });
}

function traceInfoFromLoadedTrace(
	loadedTrace: Awaited<ReturnType<typeof loadTraceInServiceWorker>>,
	source: { traceZip: string } | { traceSource: string },
): TraceInfoData {
	const baseUrl = getTraceViewerApiUrl(loadedTrace.traceId);
	const screenshots = loadedTrace.screenshotMetas.map((screenshot) =>
		screenshotInfo(screenshot, screenshotUrl(baseUrl, screenshot.file, source)),
	);

	return {
		testInfo: deriveTestInfoFromOtlpExport(loadedTrace.traceData),
		traceData: loadedTrace.traceData,
		loadScreenshots: async () => screenshots,
		loadActions: async () => loadedTrace.actions,
	};
}

/** A trace's screenshots, with the actions recorded alongside them. */
export interface LoadedScreenshots {
	screenshots: ScreenshotInfo[];
	actions: TraceAction[];
}

/** A screenshot as the viewer shows it: where to get it and what it's of. */
export function screenshotInfo(
	screenshot: ScreenshotMeta,
	url: string,
): ScreenshotInfo {
	const { viewportWidth, viewportHeight } = screenshot;
	return {
		timestamp: screenshot.timestamp,
		url,
		pageId: screenshot.pageId,
		...(viewportWidth !== undefined && viewportHeight !== undefined
			? { viewportWidth, viewportHeight }
			: {}),
	};
}

export async function loadScreenshotsForTrace(
	traceId: string,
	screenshotsZipUrl: string,
): Promise<LoadedScreenshots> {
	const { screenshotMetas, actions } =
		await loadScreenshotsForTraceInServiceWorker({
			traceId,
			screenshotsZipUrl,
		});
	const baseUrl = getTraceViewerApiUrl(traceId);
	return {
		screenshots: screenshotMetas.map((screenshot) =>
			screenshotInfo(
				screenshot,
				screenshotUrl(baseUrl, screenshot.file, {
					screenshotsZip: screenshotsZipUrl,
				}),
			),
		),
		actions,
	};
}

export async function loadScreenshotsZipForTrace(
	traceId: string,
	zip: Blob,
): Promise<LoadedScreenshots> {
	const { screenshotMetas, actions } = await loadScreenshotsZipInServiceWorker({
		traceId,
		zip,
	});
	const baseUrl = getTraceViewerApiUrl(traceId);
	return {
		screenshots: screenshotMetas.map((screenshot) =>
			screenshotInfo(screenshot, screenshotUrl(baseUrl, screenshot.file)),
		),
		actions,
	};
}

function screenshotUrl(
	baseUrl: string,
	file: string,
	source?:
		| { screenshotsZip: string }
		| { traceZip: string }
		| { traceSource: string },
): string {
	const query = source ? `?${sourceQuery(source)}` : "";
	return `${baseUrl}/screenshots/${encodeURIComponent(file)}${query}`;
}

function sourceQuery(
	source:
		| { screenshotsZip: string }
		| { traceZip: string }
		| { traceSource: string },
): string {
	if ("screenshotsZip" in source) {
		return `screenshotsZip=${encodeURIComponent(source.screenshotsZip)}`;
	}
	if ("traceZip" in source) {
		return `traceZip=${encodeURIComponent(source.traceZip)}`;
	}
	return `traceSource=${encodeURIComponent(source.traceSource)}`;
}

function createLocalZipSourceId(): string {
	localZipSourceCounter += 1;
	return `local-zip-${Date.now()}-${localZipSourceCounter}`;
}

/**
 * Lets go of a slot's trace. The primary takes the comparison with it, as one
 * is only ever loaded beside the other.
 */
export async function unloadTrace(slot: TraceSlot): Promise<void> {
	if (slot === "comparison") {
		unloadPageScreenshots("comparison");
		return;
	}
	unloadPageScreenshots();
	await unloadTraceFromServiceWorker();
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
	if (!swRegistrationPromise) {
		swRegistrationPromise = registerServiceWorker();
	}
	return swRegistrationPromise;
}
