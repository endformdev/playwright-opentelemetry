import {
	getScreenshotUrl,
	getTraceFileUrl,
	loadTraceInServiceWorker,
	registerServiceWorker,
	unloadTraceFromServiceWorker,
} from "../../service-worker/register";
import type { ScreenshotInfo, TraceInfo } from "../TraceInfoLoader";
import { loadZipFile } from "./zips";

let swRegistrationPromise: Promise<ServiceWorkerRegistration> | null = null;

export async function loadLocalZip(file: File): Promise<TraceInfo> {
	await unloadCurrentTrace();
	await ensureServiceWorker();

	const zipResult = await loadZipFile(file);

	// Send all data to service worker
	await loadTraceInServiceWorker({
		testInfo: zipResult.testInfo,
		traceFiles: zipResult.traceFiles,
		screenshots: Array.from(zipResult.screenshots.entries()).map(
			([name, blob]) => ({ name, blob }),
		),
		screenshotMetas: zipResult.screenshotMetas,
	});

	// Build trace data URLs from trace file names
	const traceDataUrls = zipResult.traceFiles.map((tf) =>
		getTraceFileUrl(tf.name),
	);

	// Build screenshot infos with URLs
	const screenshots: ScreenshotInfo[] = zipResult.screenshotMetas.map(
		(meta) => ({
			timestamp: meta.timestamp,
			url: getScreenshotUrl(meta.file),
		}),
	);

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

	// Send all data to service worker
	await loadTraceInServiceWorker({
		testInfo: zipResult.testInfo,
		traceFiles: zipResult.traceFiles,
		screenshots: Array.from(zipResult.screenshots.entries()).map(
			([name, blob]) => ({ name, blob }),
		),
		screenshotMetas: zipResult.screenshotMetas,
	});

	// Build trace data URLs from trace file names
	const traceDataUrls = zipResult.traceFiles.map((tf) =>
		getTraceFileUrl(tf.name),
	);

	// Build screenshot infos with URLs
	const screenshots: ScreenshotInfo[] = zipResult.screenshotMetas.map(
		(meta) => ({
			timestamp: meta.timestamp,
			url: getScreenshotUrl(meta.file),
		}),
	);

	return {
		testInfo: zipResult.testInfo,
		traceDataUrls,
		screenshots,
	};
}

export async function unloadCurrentTrace(): Promise<void> {
	await unloadTraceFromServiceWorker();
}

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
	if (!swRegistrationPromise) {
		swRegistrationPromise = registerServiceWorker();
	}
	return swRegistrationPromise;
}
