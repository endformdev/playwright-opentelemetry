/**
 * Service Worker registration and communication utilities.
 */

export interface ServiceWorkerState {
	registration: ServiceWorkerRegistration | null;
	ready: boolean;
	error: Error | null;
}

/**
 * Messages that can be sent to the service worker
 */
export type ServiceWorkerMessage =
	| {
			type: "LOAD_TRACE";
			traceId: string;
			data: {
				screenshots: Array<{ name: string; blob: Blob }>;
				traceData: unknown;
			};
	  }
	| { type: "UNLOAD_TRACE"; traceId: string }
	| { type: "PING" };

/**
 * Messages received from the service worker
 */
export type ServiceWorkerResponse =
	| { type: "TRACE_LOADED"; traceId: string }
	| { type: "PONG" };

/**
 * Get the service worker URL based on environment.
 * Uses vite-plugin-pwa pattern for dev/prod service workers.
 */
function getServiceWorkerUrl(): string {
	return import.meta.env.MODE === "production" ? "/sw.js" : "/dev-sw.js?dev-sw";
}

/**
 * Get the service worker type based on environment.
 * Dev mode uses ES modules, production uses classic scripts.
 */
function getServiceWorkerType(): "module" | "classic" {
	return import.meta.env.MODE === "production" ? "classic" : "module";
}

/**
 * Register the service worker and wait for it to be ready.
 * Follows Playwright's pattern for ensuring the SW is active before use.
 */
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

/**
 * Wait for an active service worker
 */
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
	traceId: string,
	screenshots: Map<string, Blob>,
	traceData: unknown,
): Promise<void> {
	const registration = await navigator.serviceWorker.ready;
	const worker = registration.active;

	if (!worker) {
		throw new Error("No active service worker");
	}

	// Convert screenshots map to array for transfer
	const screenshotArray = Array.from(screenshots.entries()).map(
		([name, blob]) => ({ name, blob }),
	);

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error("Timeout loading trace in service worker"));
		}, 30000);

		const handleMessage = (event: MessageEvent) => {
			if (
				event.data?.type === "TRACE_LOADED" &&
				event.data.traceId === traceId
			) {
				clearTimeout(timeout);
				navigator.serviceWorker.removeEventListener("message", handleMessage);
				resolve();
			}
		};

		navigator.serviceWorker.addEventListener("message", handleMessage);

		worker.postMessage({
			type: "LOAD_TRACE",
			traceId,
			data: {
				screenshots: screenshotArray,
				traceData,
			},
		});
	});
}

/**
 * Unload trace data from the service worker
 */
export async function unloadTraceFromServiceWorker(
	traceId: string,
): Promise<void> {
	const registration = await navigator.serviceWorker.ready;
	const worker = registration.active;

	if (worker) {
		worker.postMessage({ type: "UNLOAD_TRACE", traceId });
	}
}

/**
 * Generate the screenshot URL for a given trace and filename.
 * This URL will be intercepted by the service worker.
 */
export function getScreenshotUrl(traceId: string, filename: string): string {
	return `/screenshots/${traceId}/${filename}`;
}

/**
 * Generate a unique trace ID for this session
 */
export function generateTraceId(): string {
	return `trace-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
