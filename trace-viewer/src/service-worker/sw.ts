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

// Store loaded trace data per trace ID
interface LoadedTrace {
	screenshots: Map<string, Blob>;
	traceData: unknown;
}

const loadedTraces = new Map<string, LoadedTrace>();
const clientToTrace = new Map<string, string>();

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
	const { type, traceId, data } = event.data;

	switch (type) {
		case "LOAD_TRACE": {
			// Store trace data keyed by trace ID
			loadedTraces.set(traceId, {
				screenshots: deserializeScreenshots(data.screenshots),
				traceData: data.traceData,
			});

			// Associate this client with the trace
			const clientId = (event.source as Client | null)?.id;
			if (clientId) {
				clientToTrace.set(clientId, traceId);
			}

			// Notify the client that loading is complete
			(event.source as Client | null)?.postMessage({
				type: "TRACE_LOADED",
				traceId,
			});
			break;
		}

		case "UNLOAD_TRACE": {
			loadedTraces.delete(traceId);
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
	// Pattern: /screenshots/{traceId}/{filename}
	const match = url.pathname.match(/^\/screenshots\/([^/]+)\/(.+)$/);
	if (!match) {
		return; // Let the request pass through
	}

	const [, traceId, filename] = match;

	event.respondWith(
		(async () => {
			const trace = loadedTraces.get(traceId);
			if (!trace) {
				return new Response("Trace not loaded", { status: 404 });
			}

			const screenshot = trace.screenshots.get(filename);
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

// Cleanup old traces when clients disconnect
async function cleanupOrphanedTraces(): Promise<void> {
	const clients = await sw.clients.matchAll();
	const activeClientIds = new Set(clients.map((c: Client) => c.id));

	// Remove traces for disconnected clients
	for (const [clientId, traceId] of clientToTrace) {
		if (!activeClientIds.has(clientId)) {
			clientToTrace.delete(clientId);

			// Check if any other client is using this trace
			let traceInUse = false;
			for (const id of clientToTrace.values()) {
				if (id === traceId) {
					traceInUse = true;
					break;
				}
			}

			if (!traceInUse) {
				loadedTraces.delete(traceId);
			}
		}
	}
}

// Run cleanup periodically
setInterval(cleanupOrphanedTraces, 30000);
