/**
 * Service Worker for serving trace data from ZIP files.
 *
 * This service worker intercepts fetch requests and serves trace data
 * as if it were coming from a remote API. It implements the Trace API:
 *
 * - GET /test.json - Base test information
 * - GET /opentelemetry-protocol - List of trace files
 * - GET /opentelemetry-protocol/{file} - Individual trace file
 * - GET /screenshots - List of screenshots
 * - GET /screenshots/{filename} - Individual screenshot
 */

// TypeScript needs this triple-slash directive for service worker types
/// <reference lib="webworker" />

// Cast self to ServiceWorkerGlobalScope for proper typing
const sw = self as unknown as ServiceWorkerGlobalScope;

/**
 * Screenshot metadata for the /screenshots list endpoint
 */
interface ScreenshotMeta {
	timestamp: number;
	file: string;
}

/**
 * Currently loaded trace data (only one trace at a time)
 */
interface LoadedTrace {
	/** Base test information from test.json */
	testInfo: unknown;
	/** Map of filename -> JSON content for trace files */
	traceFiles: Map<string, unknown>;
	/** Map of filename -> Blob for screenshots */
	screenshots: Map<string, Blob>;
	/** Screenshot metadata for list endpoint */
	screenshotMetas: ScreenshotMeta[];
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
	const client = event.source as Client | null;

	switch (type) {
		case "LOAD_TRACE": {
			try {
				// Store trace data (replacing any previously loaded trace)
				currentTrace = {
					testInfo: data.testInfo,
					traceFiles: deserializeTraceFiles(data.traceFiles),
					screenshots: deserializeScreenshots(data.screenshots),
					screenshotMetas: data.screenshotMetas,
				};

				// Notify the client that loading is complete
				client?.postMessage({
					type: "TRACE_LOADED",
				});
			} catch (error) {
				// Send error back to client so it doesn't hang waiting for TRACE_LOADED
				const message = error instanceof Error ? error.message : String(error);
				client?.postMessage({
					type: "TRACE_LOAD_ERROR",
					error: message,
				});
			}
			break;
		}

		case "UNLOAD_TRACE": {
			currentTrace = null;
			break;
		}

		case "PING": {
			client?.postMessage({ type: "PONG" });
			break;
		}
	}
});

// Fetch handler - intercept trace API requests
sw.addEventListener("fetch", (event: FetchEvent) => {
	const url = new URL(event.request.url);
	const pathname = url.pathname;

	// Only handle requests when we have trace data loaded
	if (!currentTrace) {
		return;
	}

	// GET /test.json
	if (pathname === "/test.json") {
		event.respondWith(jsonResponse(currentTrace.testInfo));
		return;
	}

	// GET /opentelemetry-protocol (list trace files)
	if (pathname === "/opentelemetry-protocol") {
		const jsonFiles = Array.from(currentTrace.traceFiles.keys());
		event.respondWith(jsonResponse({ jsonFiles }));
		return;
	}

	// GET /opentelemetry-protocol/{file}
	const traceFileMatch = pathname.match(/^\/opentelemetry-protocol\/(.+)$/);
	if (traceFileMatch) {
		const filename = traceFileMatch[1];
		const traceData = currentTrace.traceFiles.get(filename);

		if (traceData) {
			event.respondWith(jsonResponse(traceData));
		} else {
			event.respondWith(notFoundResponse(`Trace file not found: ${filename}`));
		}
		return;
	}

	// GET /screenshots (list screenshots)
	if (pathname === "/screenshots") {
		event.respondWith(
			jsonResponse({ screenshots: currentTrace.screenshotMetas }),
		);
		return;
	}

	// GET /screenshots/{filename}
	const screenshotMatch = pathname.match(/^\/screenshots\/(.+)$/);
	if (screenshotMatch) {
		const filename = screenshotMatch[1];
		const screenshot = currentTrace.screenshots.get(filename);

		if (screenshot) {
			event.respondWith(blobResponse(screenshot));
		} else {
			event.respondWith(notFoundResponse(`Screenshot not found: ${filename}`));
		}
		return;
	}

	// Let other requests pass through
});

/**
 * Create a JSON response
 */
function jsonResponse(data: unknown): Response {
	return new Response(JSON.stringify(data), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "no-cache",
		},
	});
}

/**
 * Create a blob response (for screenshots)
 */
function blobResponse(blob: Blob): Response {
	return new Response(blob, {
		status: 200,
		headers: {
			"Content-Type": blob.type || "image/jpeg",
			"Cache-Control": "no-cache",
		},
	});
}

/**
 * Create a 404 response
 */
function notFoundResponse(message: string): Response {
	return new Response(message, { status: 404 });
}

/**
 * Deserialize trace files from the transferred format
 */
function deserializeTraceFiles(
	data: Array<{ name: string; content: unknown }>,
): Map<string, unknown> {
	const map = new Map<string, unknown>();
	for (const { name, content } of data) {
		map.set(name, content);
	}
	return map;
}

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
