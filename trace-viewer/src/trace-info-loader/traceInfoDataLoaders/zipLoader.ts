import {
	getTraceViewerApiUrl,
	loadScreenshotsForTraceInServiceWorker,
	loadScreenshotsZipInServiceWorker,
	loadTraceInServiceWorker,
	loadTraceZipUrlInServiceWorker,
	registerServiceWorker,
	unloadTraceFromServiceWorker,
} from "../../service-worker/register";
import type { ScreenshotInfo, TraceInfoData } from "../TraceInfoLoader";
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
	const screenshots = loadedTrace.screenshotMetas.map((screenshot) => ({
		timestamp: screenshot.timestamp,
		url: screenshotUrl(baseUrl, screenshot.file, source),
		pageId: screenshot.pageId,
	}));

	return {
		testInfo: deriveTestInfoFromOtlpExport(loadedTrace.traceData),
		traceData: loadedTrace.traceData,
		loadScreenshots: async () => screenshots,
	};
}

export async function loadScreenshotsForTrace(
	traceId: string,
	screenshotsZipUrl: string,
): Promise<ScreenshotInfo[]> {
	const screenshotMetas = await loadScreenshotsForTraceInServiceWorker({
		traceId,
		screenshotsZipUrl,
	});
	const baseUrl = getTraceViewerApiUrl(traceId);
	return screenshotMetas.map((screenshot) => ({
		timestamp: screenshot.timestamp,
		url: screenshotUrl(baseUrl, screenshot.file, {
			screenshotsZip: screenshotsZipUrl,
		}),
		pageId: screenshot.pageId,
	}));
}

export async function loadScreenshotsZipForTrace(
	traceId: string,
	zip: Blob,
): Promise<ScreenshotInfo[]> {
	const screenshotMetas = await loadScreenshotsZipInServiceWorker({
		traceId,
		zip,
	});
	const baseUrl = getTraceViewerApiUrl(traceId);
	return screenshotMetas.map((screenshot) => ({
		timestamp: screenshot.timestamp,
		url: screenshotUrl(baseUrl, screenshot.file),
		pageId: screenshot.pageId,
	}));
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
