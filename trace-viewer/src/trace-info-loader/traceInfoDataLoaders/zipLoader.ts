import { createSignal } from "solid-js";
import {
	getTraceViewerApiUrl,
	loadScreenshotsZipInServiceWorker,
	loadTraceInServiceWorker,
	registerServiceWorker,
	unloadTraceFromServiceWorker,
} from "../../service-worker/register";
import type { ScreenshotInfo, TraceInfo } from "../TraceInfoLoader";
import { deriveTestInfoFromOtlpExport } from "../deriveTestInfo";

let swRegistrationPromise: Promise<ServiceWorkerRegistration> | null = null;

export async function loadLocalZip(file: File): Promise<TraceInfo> {
	await ensureServiceWorker();
	await unloadCurrentTrace();

	return loadZipBlob(file);
}

export async function loadRemoteZip(url: string): Promise<TraceInfo> {
	await ensureServiceWorker();
	await unloadCurrentTrace();

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch ZIP from ${url}: ${response.statusText}`);
	}

	return loadZipBlob(await response.blob());
}

async function loadZipBlob(zip: Blob): Promise<TraceInfo> {
	const loadedTrace = await loadTraceInServiceWorker({ zip });
	const baseUrl = getTraceViewerApiUrl(loadedTrace.traceId);

	return {
		testInfo: deriveTestInfoFromOtlpExport(loadedTrace.traceData),
		traceData: loadedTrace.traceData,
		screenshots: createSignal(
			loadedTrace.screenshotMetas.map((screenshot) => ({
				timestamp: screenshot.timestamp,
				url: `${baseUrl}/screenshots/${screenshot.file}`,
			})),
		)[0],
	};
}

export async function loadScreenshotsZipForTrace(
	traceId: string,
	zip: Blob,
): Promise<ScreenshotInfo[]> {
	const screenshotMetas = await loadScreenshotsZipInServiceWorker({ traceId, zip });
	const baseUrl = getTraceViewerApiUrl(traceId);
	return screenshotMetas.map((screenshot) => ({
		timestamp: screenshot.timestamp,
		url: `${baseUrl}/screenshots/${screenshot.file}`,
	}));
}

export async function unloadCurrentTrace(): Promise<void> {
	await unloadTraceFromServiceWorker();
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
	if (!swRegistrationPromise) {
		swRegistrationPromise = registerServiceWorker();
	}
	return swRegistrationPromise;
}
