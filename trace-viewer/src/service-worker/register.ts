import { getBasePath, resolveBasePath } from "../basePath";
import type { OtlpExport } from "../trace-data-loader";

export interface ServiceWorkerState {
	registration: ServiceWorkerRegistration | null;
	ready: boolean;
	error: Error | null;
}

/**
 * Screenshot metadata for the /screenshots list endpoint
 */
export interface ScreenshotMeta {
	timestamp: number;
	file: string;
	path: string;
	contentType: string;
	contextId: string;
	pageId: string;
}

/**
 * Data to send to the service worker when loading a trace
 */
export interface TraceLoadData {
	zip: Blob;
	sourceId?: string;
}

export interface TraceZipUrlLoadData {
	zipUrl: string;
}

export interface ScreenshotsZipLoadData {
	traceId: string;
	zip: Blob;
}

export interface ScreenshotsLoadData {
	traceId: string;
	screenshotsZipUrl: string;
}

export interface TraceLoadedData {
	traceId: string;
	traceData: OtlpExport;
	screenshotMetas: ScreenshotMeta[];
}

export type ServiceWorkerMessage =
	| {
			type: "LOAD_TRACE";
			data: TraceLoadData;
	  }
	| {
			type: "LOAD_TRACE_ZIP_URL";
			data: TraceZipUrlLoadData;
	  }
	| {
			type: "LOAD_SCREENSHOTS";
			data: ScreenshotsLoadData;
	  }
	| {
			type: "LOAD_SCREENSHOTS_ZIP";
			data: ScreenshotsZipLoadData;
	  }
	| { type: "UNLOAD_TRACE" }
	| { type: "CLEAR_SCREENSHOT_STATE" }
	| { type: "PING" };

export type ServiceWorkerResponse =
	| { type: "TRACE_LOADED"; data: TraceLoadedData }
	| { type: "SCREENSHOTS_LOADED"; data: { screenshotMetas: ScreenshotMeta[] } }
	| { type: "TRACE_LOAD_ERROR"; error: string }
	| { type: "SCREENSHOTS_LOAD_ERROR"; error: string }
	| { type: "PONG" };

type ServiceWorkerMessageWithRequestId = ServiceWorkerMessage & {
	requestId: string;
};

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
	if (!("serviceWorker" in navigator)) {
		throw new Error("Service Workers are not supported in this browser");
	}

	const basePath = getBasePath();
	const swUrl = getServiceWorkerUrl();

	// Register the service worker with scope matching the base path
	const registration = await navigator.serviceWorker.register(swUrl, {
		scope: basePath,
		type: "module",
	});

	// Wait for the service worker to be active and controlling this page.
	await navigator.serviceWorker.ready;
	await waitForActiveWorker(registration);
	const controller = await waitForController();

	await pingServiceWorker(controller);

	return registration;
}

async function waitForController(): Promise<ServiceWorker> {
	if (navigator.serviceWorker.controller) {
		return navigator.serviceWorker.controller;
	}

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			navigator.serviceWorker.removeEventListener(
				"controllerchange",
				handleControllerChange,
			);
			reject(new Error("Timeout waiting for service worker to control page"));
		}, 10000);

		const handleControllerChange = () => {
			const controller = navigator.serviceWorker.controller;
			if (!controller) return;

			clearTimeout(timeout);
			navigator.serviceWorker.removeEventListener(
				"controllerchange",
				handleControllerChange,
			);
			resolve(controller);
		};

		navigator.serviceWorker.addEventListener(
			"controllerchange",
			handleControllerChange,
		);
	});
}

async function waitForActiveWorker(
	registration: ServiceWorkerRegistration,
): Promise<ServiceWorker> {
	if (registration.active) {
		return registration.active;
	}

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error("Timeout waiting for service worker to activate"));
		}, 10000);

		const handleStateChange = () => {
			if (registration.active) {
				clearTimeout(timeout);
				registration.installing?.removeEventListener(
					"statechange",
					handleStateChange,
				);
				registration.waiting?.removeEventListener(
					"statechange",
					handleStateChange,
				);
				resolve(registration.active);
			}
		};

		registration.installing?.addEventListener("statechange", handleStateChange);
		registration.waiting?.addEventListener("statechange", handleStateChange);

		// Also check immediately in case it activated between checks
		if (registration.active) {
			clearTimeout(timeout);
			resolve(registration.active);
		}
	});
}

/**
 * Ping the service worker to verify it's responsive
 */
async function pingServiceWorker(worker: ServiceWorker): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error("Service worker did not respond to ping"));
		}, 5000);

		const handleMessage = (event: MessageEvent) => {
			if (event.data?.type === "PONG") {
				clearTimeout(timeout);
				navigator.serviceWorker.removeEventListener("message", handleMessage);
				resolve();
			}
		};

		navigator.serviceWorker.addEventListener("message", handleMessage);
		worker.postMessage({ type: "PING" });
	});
}

/**
 * Send trace data to the service worker
 */
export async function loadTraceInServiceWorker(
	data: TraceLoadData,
): Promise<TraceLoadedData> {
	return postServiceWorkerMessage<TraceLoadedData>(
		{ type: "LOAD_TRACE", data },
		"TRACE_LOADED",
		"TRACE_LOAD_ERROR",
		"Timeout loading trace in service worker",
	);
}

export async function loadTraceZipUrlInServiceWorker(
	data: TraceZipUrlLoadData,
): Promise<TraceLoadedData> {
	return postServiceWorkerMessage<TraceLoadedData>(
		{ type: "LOAD_TRACE_ZIP_URL", data },
		"TRACE_LOADED",
		"TRACE_LOAD_ERROR",
		"Timeout loading trace ZIP in service worker",
	);
}

export async function loadScreenshotsForTraceInServiceWorker(
	data: ScreenshotsLoadData,
): Promise<ScreenshotMeta[]> {
	const result = await postServiceWorkerMessage<{
		screenshotMetas: ScreenshotMeta[];
	}>(
		{ type: "LOAD_SCREENSHOTS", data },
		"SCREENSHOTS_LOADED",
		"SCREENSHOTS_LOAD_ERROR",
		"Timeout loading screenshots in service worker",
	);
	return result.screenshotMetas;
}

export async function loadScreenshotsZipInServiceWorker(
	data: ScreenshotsZipLoadData,
): Promise<ScreenshotMeta[]> {
	const result = await postServiceWorkerMessage<{
		screenshotMetas: ScreenshotMeta[];
	}>(
		{ type: "LOAD_SCREENSHOTS_ZIP", data },
		"SCREENSHOTS_LOADED",
		"SCREENSHOTS_LOAD_ERROR",
		"Timeout loading screenshots ZIP in service worker",
	);
	return result.screenshotMetas;
}

async function postServiceWorkerMessage<Data>(
	message: ServiceWorkerMessage,
	loadedType: string,
	errorType: string,
	timeoutMessage: string,
): Promise<Data> {
	await navigator.serviceWorker.ready;
	const worker = await waitForController();
	const requestId = crypto.randomUUID();
	const messageWithRequestId: ServiceWorkerMessageWithRequestId = {
		...message,
		requestId,
	};

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			navigator.serviceWorker.removeEventListener("message", handleMessage);
			reject(new Error(timeoutMessage));
		}, 30000);

		const handleMessage = (event: MessageEvent) => {
			if (event.data?.requestId !== requestId) return;

			if (event.data?.type === loadedType) {
				clearTimeout(timeout);
				navigator.serviceWorker.removeEventListener("message", handleMessage);
				resolve(event.data.data as Data);
			} else if (event.data?.type === errorType) {
				clearTimeout(timeout);
				navigator.serviceWorker.removeEventListener("message", handleMessage);
				reject(
					new Error(
						`Service worker error: ${event.data.error || "Unknown error"}`,
					),
				);
			}
		};

		navigator.serviceWorker.addEventListener("message", handleMessage);
		worker.postMessage(messageWithRequestId);
	});
}

/**
 * Unload trace data from the service worker
 */
export async function unloadTraceFromServiceWorker(): Promise<void> {
	const registration = await navigator.serviceWorker.ready;
	const worker = registration.active;

	if (worker) {
		worker.postMessage({ type: "UNLOAD_TRACE" });
	}
}

export function getTraceViewerApiUrl(traceId: string): string {
	return resolveBasePath(`playwright-otel-trace-viewer/v1/${traceId}`);
}

function getServiceWorkerUrl(): string {
	// Use base path to construct the service worker URL
	return import.meta.env.MODE === "production"
		? resolveBasePath("sw.js")
		: resolveBasePath("dev-sw.js?dev-sw");
}
