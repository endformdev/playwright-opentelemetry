import type { EventHandler } from "h3";
import { createError, defineEventHandler, getRouterParam } from "h3";
import { applyCors } from "../cors";
import type { TraceApiHandlerConfig } from "../createTraceApi";

/**
 * Create a handler for the trace viewer read API.
 *
 * Serves trace data in the format expected by the trace viewer:
 * - GET /otel-trace-viewer/{traceId}/test.json
 * - GET /otel-trace-viewer/{traceId}/opentelemetry-protocol -> { jsonFiles: [...] }
 * - GET /otel-trace-viewer/{traceId}/opentelemetry-protocol/{file}.json
 * - GET /otel-trace-viewer/{traceId}/screenshots -> { screenshots: [...] }
 * - GET /otel-trace-viewer/{traceId}/screenshots/{filename}
 *
 * @param config - TraceApiHandlerConfig with storage and optional CORS/resolvePath settings
 * @returns H3 event handler
 *
 * @example
 * ```ts
 * import { TRACE_VIEWER_READ_PATH } from '@playwright-opentelemetry/trace-api';
 *
 * const router = createRouter();
 * // TRACE_VIEWER_READ_PATH = '/otel-trace-viewer/**'
 * router.get(TRACE_VIEWER_READ_PATH, createViewerHandler({ storage }));
 * ```
 */
export function createViewerHandler(
	config: TraceApiHandlerConfig,
): EventHandler {
	const storage = config.storage;

	return defineEventHandler(async (event) => {
		// Handle CORS if configured
		const corsResponse = applyCors(event, config.corsOrigin);
		if (corsResponse) {
			return corsResponse;
		}
		// Get the full path after /otel-trace-viewer/
		const path = getRouterParam(event, "_");
		if (!path) {
			throw new Error("Path is required");
		}

		// Parse the path to determine what to return
		// Expected format: {traceId}/... or {traceId}/opentelemetry-protocol or {traceId}/opentelemetry-protocol/{file}
		const parts = path.split("/");
		const traceId = parts[0];

		if (parts.length === 1) {
			// GET /otel-trace-viewer/{traceId} - not implemented yet
			throw new Error("Trace listing not implemented");
		}

		if (parts.length === 2 && parts[1] === "opentelemetry-protocol") {
			// List all JSON files in opentelemetry-protocol directory
			let prefix = `traces/${traceId}/opentelemetry-protocol/`;

			// Apply path resolution if configured
			let resolvedPrefix = prefix;
			if (config.resolvePath) {
				resolvedPrefix = await config.resolvePath(event, prefix);
			}

			const files = await storage.list(resolvedPrefix);

			// Extract just the filenames (remove prefix)
			const jsonFiles = files
				.map((file) => file.replace(resolvedPrefix, ""))
				.filter((file) => file.endsWith(".json"));

			return { jsonFiles };
		}

		if (parts.length === 2 && parts[1] === "screenshots") {
			// List all screenshots
			let prefix = `traces/${traceId}/screenshots/`;

			// Apply path resolution if configured
			let resolvedPrefix = prefix;
			if (config.resolvePath) {
				resolvedPrefix = await config.resolvePath(event, prefix);
			}

			const files = await storage.list(resolvedPrefix);

			// Extract filenames and parse timestamps for sorting
			// Filename format: {pageId}-{timestampMs}.jpeg (e.g., page@abc-1767539662401.jpeg)
			// Timestamp is in milliseconds since epoch
			const screenshots = files
				.map((file) => {
					const filename = file.replace(resolvedPrefix, "");
					// Extract timestamp from filename (format: pageId-timestamp.jpeg)
					const match = filename.match(/-(\d+)\./);
					const timestamp = match ? Number.parseInt(match[1], 10) : 0;
					return { timestamp, file: filename };
				})
				.sort((a, b) => a.timestamp - b.timestamp);

			return { screenshots };
		}

		// Otherwise, it's a direct file request
		let storagePath = `traces/${path}`;

		// Apply path resolution if configured
		if (config.resolvePath) {
			storagePath = await config.resolvePath(event, storagePath);
		}

		const data = await storage.get(storagePath);

		if (!data) {
			throw createError({
				statusCode: 404,
				message: `File not found: ${storagePath}`,
			});
		}

		// If it's a screenshot, return as binary with caching
		if (path.includes("/screenshots/")) {
			// Return raw binary data with 10 minute cache
			return new Response(data, {
				headers: {
					"Content-Type": "image/jpeg",
					"Cache-Control": "public, max-age=600",
				},
			});
		}

		// Otherwise parse JSON and return it
		const text = new TextDecoder().decode(data);
		return JSON.parse(text);
	});
}
