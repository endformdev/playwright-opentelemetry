import type { EventHandler } from "h3";
import { defineEventHandler } from "h3";
import type { TraceStorage } from "../storage/s3";

/**
 * Create a handler for the standard OTLP trace endpoint.
 *
 * Receives OTLP JSON payloads at POST /v1/traces, extracts traceId and
 * service.name from each resourceSpan, and writes to storage at:
 * `traces/{traceId}/opentelemetry-protocol/{serviceName}.json`
 *
 * @param _storage - TraceStorage implementation
 * @returns H3 event handler
 *
 * @example
 * ```ts
 * const router = createRouter();
 * router.post('/v1/traces', createOtlpHandler(storage));
 * ```
 */
export function createOtlpHandler(_storage: TraceStorage): EventHandler {
	// TODO: Implement OTLP handler
	return defineEventHandler(async (_event) => {
		throw new Error("createOtlpHandler: not implemented");
	});
}
