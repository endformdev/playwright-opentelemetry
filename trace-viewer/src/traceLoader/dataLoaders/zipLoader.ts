import {
	generateTraceId,
	getScreenshotUrl,
	loadTraceInServiceWorker,
	registerServiceWorker,
	unloadTraceFromServiceWorker,
} from "../../serviceWorker/register";
import type { ResolvedTraceUrls } from "../TraceLoader";
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

export async function loadLocalZip(file: File): Promise<ResolvedTraceUrls> {
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

	const screenshotUrls = new Map<string, string>();
	for (const filename of zipResult.screenshotFilenames) {
		screenshotUrls.set(filename, getScreenshotUrl(traceId, filename));
	}

	const traceDataUrls = [`/traces/${traceId}/pw-reporter-trace.json`];

	return {
		traceDataUrls,
		screenshotUrls,
	};
}

export async function loadRemoteZip(url: string): Promise<ResolvedTraceUrls> {
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

	const screenshotUrls = new Map<string, string>();
	for (const filename of zipResult.screenshotFilenames) {
		screenshotUrls.set(filename, getScreenshotUrl(traceId, filename));
	}

	const traceDataUrls = [`/traces/${traceId}/pw-reporter-trace.json`];

	return {
		traceDataUrls,
		screenshotUrls,
	};
}
