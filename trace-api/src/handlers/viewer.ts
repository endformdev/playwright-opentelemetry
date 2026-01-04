import type { EventHandler } from "h3";
import { createError, defineEventHandler, getRouterParam } from "h3";
import type { TraceStorage } from "../storage/s3";

/**
 * Create a handler for the trace viewer read API.
 *
 * Serves trace data in the format expected by the trace viewer:
 * - GET /test-traces/{traceId}/test.json
 * - GET /test-traces/{traceId}/opentelemetry-protocol -> { jsonFiles: [...] }
 * - GET /test-traces/{traceId}/opentelemetry-protocol/{file}.json
 * - GET /test-traces/{traceId}/screenshots -> { screenshots: [...] }
 * - GET /test-traces/{traceId}/screenshots/{filename}
 *
 * @param storage - TraceStorage implementation
 * @returns H3 event handler
 *
 * @example
 * ```ts
 * import { TRACES_READ_PATH } from '@playwright-opentelemetry/trace-api';
 *
 * const router = createRouter();
 * // TRACES_READ_PATH = '/test-traces/**'
 * router.get(TRACES_READ_PATH, createViewerHandler(storage));
 * ```
 */
export function createViewerHandler(storage: TraceStorage): EventHandler {
	return defineEventHandler(async (event) => {
		// Get the full path after /test-traces/
		const path = getRouterParam(event, "_");
		if (!path) {
			throw new Error("Path is required");
		}

		// Parse the path to determine what to return
		// Expected format: {traceId}/... or {traceId}/opentelemetry-protocol or {traceId}/opentelemetry-protocol/{file}
		const parts = path.split("/");
		const traceId = parts[0];

		if (parts.length === 1) {
			// GET /test-traces/{traceId} - not implemented yet
			throw new Error("Trace listing not implemented");
		}

		if (parts.length === 2 && parts[1] === "opentelemetry-protocol") {
			// List all JSON files in opentelemetry-protocol directory
			const prefix = `traces/${traceId}/opentelemetry-protocol/`;
			const files = await storage.list(prefix);

			// Extract just the filenames (remove prefix)
			const jsonFiles = files
				.map((file) => file.replace(prefix, ""))
				.filter((file) => file.endsWith(".json"));

			return { jsonFiles };
		}

		if (parts.length === 2 && parts[1] === "screenshots") {
			// List all screenshots
			const prefix = `traces/${traceId}/screenshots/`;
			const files = await storage.list(prefix);

			// Extract filenames and parse timestamps for sorting
			// Filename format: {pageId}-{timestampMs}.jpeg (e.g., page@abc-1767539662401.jpeg)
			// Timestamp is in milliseconds since epoch
			const screenshots = files
				.map((file) => {
					const filename = file.replace(prefix, "");
					// Extract timestamp from filename (format: pageId-timestamp.jpeg)
					const match = filename.match(/-(\d+)\./);
					const timestamp = match ? Number.parseInt(match[1], 10) : 0;
					return { timestamp, file: filename };
				})
				.sort((a, b) => a.timestamp - b.timestamp);

			return { screenshots };
		}

		// Otherwise, it's a direct file request
		const storagePath = `traces/${path}`;
		const data = await storage.get(storagePath);

		if (!data) {
			throw createError({
				statusCode: 404,
				message: `File not found: ${storagePath}`,
			});
		}

		// If it's a screenshot, return as binary
		if (path.includes("/screenshots/")) {
			// Return raw binary data
			return new Response(data, {
				headers: {
					"Content-Type": "image/jpeg",
				},
			});
		}

		// Otherwise parse JSON and return it
		const text = new TextDecoder().decode(data);
		return JSON.parse(text);
	});
}
