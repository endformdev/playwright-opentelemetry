/**
 * Service Worker for serving trace data from ZIP files.
 *
 * This service worker intercepts fetch requests and serves screenshots
 * from the loaded ZIP file in memory.
 */

// TypeScript needs this triple-slash directive for service worker types
/// <reference lib="webworker" />

// Cast self to ServiceWorkerGlobalScope for proper typing
const sw = self as unknown as ServiceWorkerGlobalScope;

// Store currently loaded trace data (only one trace at a time)
interface LoadedTrace {
	screenshots: Map<string, Blob>;
	traceData: unknown;
}

let currentTrace: LoadedTrace | null = null;

// Install event - skip waiting to activate immediately
sw.addEventListener("install", () => {
	sw.skipWaiting();
});

// Activate event - claim all clients
sw.addEventListener("activate", (event: ExtendableEvent) => {
	event.waitUntil(sw.clients.claim());
});

// Message handler for loading trace data
sw.addEventListener("message", (event: ExtendableMessageEvent) => {
	const { type, data } = event.data;

	switch (type) {
		case "LOAD_TRACE": {
			// Store trace data (replacing any previously loaded trace)
			currentTrace = {
				screenshots: deserializeScreenshots(data.screenshots),
				traceData: data.traceData,
			};

			// Notify the client that loading is complete
			(event.source as Client | null)?.postMessage({
				type: "TRACE_LOADED",
			});
			break;
		}

		case "UNLOAD_TRACE": {
			currentTrace = null;
			break;
		}

		case "PING": {
			(event.source as Client | null)?.postMessage({ type: "PONG" });
			break;
		}
	}
});

// Fetch handler - intercept screenshot requests
sw.addEventListener("fetch", (event: FetchEvent) => {
	const url = new URL(event.request.url);

	// Check if this is a screenshot request
	// Pattern: /screenshots/{filename}
	const match = url.pathname.match(/^\/screenshots\/(.+)$/);
	if (!match) {
		return; // Let the request pass through
	}

	const [, filename] = match;

	event.respondWith(
		(async () => {
			if (!currentTrace) {
				return new Response("Trace not loaded", { status: 404 });
			}

			const screenshot = currentTrace.screenshots.get(filename);
			if (!screenshot) {
				return new Response("Screenshot not found", { status: 404 });
			}

			return new Response(screenshot, {
				status: 200,
				headers: {
					"Content-Type": screenshot.type || "image/jpeg",
					"Cache-Control": "no-cache",
				},
			});
		})(),
	);
});

/**
 * Deserialize screenshots from the transferred format
 */
function deserializeScreenshots(
	data: Array<{ name: string; blob: Blob }>,
): Map<string, Blob> {
	const map = new Map<string, Blob>();
	for (const { name, blob } of data) {
		map.set(name, blob);
	}
	return map;
}
