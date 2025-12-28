import {
	generateTraceId,
	getScreenshotUrl,
	loadTraceInServiceWorker,
	registerServiceWorker,
	unloadTraceFromServiceWorker,
} from "../../service-worker/register";
import type { ScreenshotInfo, TraceInfo } from "../TraceInfoLoader";
import { loadZipFile } from "./zips";

let currentTraceId: string | null = null;

let swRegistrationPromise: Promise<ServiceWorkerRegistration> | null = null;

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
	if (!swRegistrationPromise) {
		swRegistrationPromise = registerServiceWorker();
	}
	return swRegistrationPromise;
}

export async function unloadCurrentTrace(): Promise<void> {
	if (currentTraceId) {
		await unloadTraceFromServiceWorker(currentTraceId);
		currentTraceId = null;
	}
}

export async function loadLocalZip(file: File): Promise<TraceInfo> {
	await unloadCurrentTrace();
	await ensureServiceWorker();

	const zipResult = await loadZipFile(file);

	const traceId = generateTraceId();

	await loadTraceInServiceWorker(
		traceId,
		zipResult.screenshots,
		zipResult.traceData,
	);
	currentTraceId = traceId;

	// Build screenshot infos with URLs from service worker
	const screenshots: ScreenshotInfo[] = [];
	const sortedFilenames = Array.from(zipResult.screenshots.keys()).sort();

	for (const filename of sortedFilenames) {
		const timestamp = extractTimestampFromFilename(filename);
		screenshots.push({
			timestamp,
			url: getScreenshotUrl(traceId, filename),
		});
	}

	// Sort by timestamp
	screenshots.sort((a, b) => a.timestamp - b.timestamp);

	const traceDataUrls = [`/traces/${traceId}/pw-reporter-trace.json`];

	return {
		testInfo: zipResult.testInfo,
		traceDataUrls,
		screenshots,
	};
}

export async function loadRemoteZip(url: string): Promise<TraceInfo> {
	await unloadCurrentTrace();
	await ensureServiceWorker();

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch ZIP from ${url}: ${response.statusText}`);
	}

	const blob = await response.blob();

	const zipResult = await loadZipFile(blob);

	const traceId = generateTraceId();

	await loadTraceInServiceWorker(
		traceId,
		zipResult.screenshots,
		zipResult.traceData,
	);
	currentTraceId = traceId;

	// Build screenshot infos with URLs from service worker
	const screenshots: ScreenshotInfo[] = [];
	const sortedFilenames = Array.from(zipResult.screenshots.keys()).sort();

	for (const filename of sortedFilenames) {
		const timestamp = extractTimestampFromFilename(filename);
		screenshots.push({
			timestamp,
			url: getScreenshotUrl(traceId, filename),
		});
	}

	// Sort by timestamp
	screenshots.sort((a, b) => a.timestamp - b.timestamp);

	const traceDataUrls = [`/traces/${traceId}/pw-reporter-trace.json`];

	return {
		testInfo: zipResult.testInfo,
		traceDataUrls,
		screenshots,
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
