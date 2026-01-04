import type { EventHandler } from "h3";
import { defineEventHandler, getRouterParam, readBody } from "h3";
import type { TraceStorage } from "../storage/s3";

/**
 * Create a handler for Playwright-specific trace data.
 *
 * Receives test.json and screenshots at PUT /playwright-opentelemetry/*,
 * using X-Trace-Id header to determine storage location:
 * - PUT /playwright-opentelemetry/test.json -> traces/{traceId}/test.json
 * - PUT /playwright-opentelemetry/screenshots/{filename} -> traces/{traceId}/screenshots/{filename}
 *
 * @param storage - TraceStorage implementation
 * @returns H3 event handler
 *
 * @example
 * ```ts
 * import { PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH } from '@playwright-opentelemetry/trace-api';
 *
 * const router = createRouter();
 * // PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH = '/playwright-opentelemetry/**'
 * router.put(PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH, createPlaywrightHandler(storage));
 * ```
 */
export function createPlaywrightHandler(storage: TraceStorage): EventHandler {
	return defineEventHandler(async (event) => {
		// Get trace ID from header
		const traceId = event.req.headers.get("x-trace-id");
		if (!traceId) {
			throw new Error("X-Trace-Id header is required");
		}

		// Get the path after /playwright-opentelemetry/
		const path = getRouterParam(event, "_");
		if (!path) {
			throw new Error("Path is required");
		}

		// Determine content type based on the path
		const contentType = path.endsWith(".json")
			? "application/json"
			: "image/jpeg";

		// Build storage path
		const storagePath = `traces/${traceId}/${path}`;

		// Read the body - use raw body for binary data (screenshots)
		if (contentType === "image/jpeg") {
			const buffer = await event.req.arrayBuffer();
			if (!buffer) {
				throw new Error("Request body is required");
			}
			await storage.put(storagePath, buffer, contentType);
		} else {
			const body = await readBody(event);
			if (typeof body === "string" || body instanceof ArrayBuffer) {
				await storage.put(storagePath, body, contentType);
			} else {
				// If it's an object, stringify it
				await storage.put(storagePath, JSON.stringify(body), contentType);
			}
		}

		return { status: "ok" };
	});
}
