import type { EventHandler } from "h3";
import { defineEventHandler } from "h3";
import type { TraceStorage } from "../storage/s3";

/**
 * Create a handler for the trace viewer read API.
 *
 * Serves trace data in the format expected by the trace viewer:
 * - GET /traces/{traceId}/test.json
 * - GET /traces/{traceId}/opentelemetry-protocol -> { jsonFiles: [...] }
 * - GET /traces/{traceId}/opentelemetry-protocol/{file}.json
 * - GET /traces/{traceId}/screenshots -> { screenshots: [...] }
 * - GET /traces/{traceId}/screenshots/{filename}
 *
 * @param _storage - TraceStorage implementation
 * @returns H3 event handler
 *
 * @example
 * ```ts
 * const router = createRouter();
 * router.get('/traces/**', createViewerHandler(storage));
 * ```
 */
export function createViewerHandler(_storage: TraceStorage): EventHandler {
	// TODO: Implement viewer handler
	return defineEventHandler(async (_event) => {
		throw new Error("createViewerHandler: not implemented");
	});
}
