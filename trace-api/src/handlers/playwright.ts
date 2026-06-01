import type { EventHandler } from "h3";
import { defineEventHandler, getRouterParam } from "h3";
import { applyCors } from "../cors";
import type { TraceApiHandlerConfig } from "../createTraceApi";

/**
 * Create a handler for Playwright-specific trace data.
 *
 * Receives screenshots at PUT /playwright-otel-reporter/v1/*,
 * using X-Trace-Id header to determine storage location:
 * - PUT /playwright-otel-reporter/v1/screenshots/{filename} -> traces/{traceId}/screenshots/{filename}
 *
 * @param config - TraceApiHandlerConfig with storage and optional CORS/resolvePath settings
 * @returns H3 event handler
 *
 * @example
 * ```ts
 * import { PLAYWRIGHT_REPORTER_WRITE_PATH } from '@playwright-opentelemetry/trace-api';
 *
 * const router = createRouter();
 * // PLAYWRIGHT_REPORTER_WRITE_PATH = '/playwright-otel-reporter/v1/**'
 * router.put(PLAYWRIGHT_REPORTER_WRITE_PATH, createPlaywrightHandler({ storage }));
 * ```
 */
export function createPlaywrightHandler(
	config: TraceApiHandlerConfig,
): EventHandler {
	const storage = config.storage;

	return defineEventHandler(async (event) => {
		// Handle CORS if configured
		const corsResponse = applyCors(event, config.corsOrigin);
		if (corsResponse) {
			return corsResponse;
		}
		// Get trace ID from header
		const traceId = event.req.headers.get("x-trace-id");
		if (!traceId) {
			throw new Error("X-Trace-Id header is required");
		}

		// Get the path after /playwright-otel-reporter/v1/
		const path = getRouterParam(event, "_");
		if (!path) {
			throw new Error("Path is required");
		}

		if (!path.startsWith("screenshots/")) {
			throw new Error(`Unsupported Playwright artifact path: ${path}`);
		}

		const contentType = "image/jpeg";

		// Build storage path
		let storagePath = `traces/${traceId}/${path}`;

		// Apply path resolution if configured
		if (config.resolvePath) {
			storagePath = await config.resolvePath(event, storagePath);
		}

		const buffer = await event.req.arrayBuffer();
		if (!buffer) {
			throw new Error("Request body is required");
		}
		await storage.put(storagePath, buffer, contentType);

		return { status: "ok" };
	});
}
