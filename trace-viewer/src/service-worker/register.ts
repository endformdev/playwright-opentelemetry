import type { TestInfo } from "../trace-info-loader/TraceInfoLoader";

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
}

/**
 * Data to send to the service worker when loading a trace
 */
export interface TraceLoadData {
	/** Base test information from test.json */
	testInfo: TestInfo;
	/** Trace files with name and JSON content */
	traceFiles: Array<{ name: string; content: unknown }>;
	/** Screenshots with name and blob */
	screenshots: Array<{ name: string; blob: Blob }>;
	/** Screenshot metadata for list endpoint */
	screenshotMetas: ScreenshotMeta[];
}

export type ServiceWorkerMessage =
	| {
			type: "LOAD_TRACE";
			data: TraceLoadData;
	  }
	| { type: "UNLOAD_TRACE" }
	| { type: "PING" };

export type ServiceWorkerResponse = { type: "TRACE_LOADED" } | { type: "PONG" };

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
	if (!("serviceWorker" in navigator)) {
		throw new Error("Service Workers are not supported in this browser");
	}

	const swUrl = getServiceWorkerUrl();
	const swType = getServiceWorkerType();

	// Register the service worker
	const registration = await navigator.serviceWorker.register(swUrl, {
		scope: "/",
		type: swType,
	});

	// Wait for the service worker to be ready
	await navigator.serviceWorker.ready;

	// If there's a waiting worker, activate it immediately
	if (registration.waiting) {
		registration.waiting.postMessage({ type: "SKIP_WAITING" });
	}

	// Wait for the active worker to be available
	const activeWorker = await waitForActiveWorker(registration);

	// Verify the worker is responsive
	await pingServiceWorker(activeWorker);

	return registration;
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
): Promise<void> {
	const registration = await navigator.serviceWorker.ready;
	const worker = registration.active;

	if (!worker) {
		throw new Error("No active service worker");
	}

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error("Timeout loading trace in service worker"));
		}, 30000);

		const handleMessage = (event: MessageEvent) => {
			if (event.data?.type === "TRACE_LOADED") {
				clearTimeout(timeout);
				navigator.serviceWorker.removeEventListener("message", handleMessage);
				resolve();
			}
		};

		navigator.serviceWorker.addEventListener("message", handleMessage);

		worker.postMessage({
			type: "LOAD_TRACE",
			data,
		});
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

/**
 * Generate URLs for trace API endpoints.
 * These URLs will be intercepted by the service worker.
 */
export function getTraceApiUrl(path: string): string {
	return `/${path}`;
}

export function getScreenshotUrl(filename: string): string {
	return `/screenshots/${filename}`;
}

export function getTraceFileUrl(filename: string): string {
	return `/opentelemetry-protocol/${filename}`;
}

function getServiceWorkerUrl(): string {
	return import.meta.env.MODE === "production" ? "/sw.js" : "/dev-sw.js?dev-sw";
}

function getServiceWorkerType(): "module" | "classic" {
	return import.meta.env.MODE === "production" ? "classic" : "module";
}
