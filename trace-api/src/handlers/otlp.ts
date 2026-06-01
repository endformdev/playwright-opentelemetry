import type { EventHandler } from "h3";
import { defineEventHandler, readBody } from "h3";
import { applyCors } from "../cors";
import type { TraceApiHandlerConfig } from "../createTraceApi";
import { type OtlpExport, partitionOtlpExportByTraceId } from "../otlp";

/**
 * Create a handler for the standard OTLP trace endpoint.
 *
 * Receives OTLP JSON payloads at POST /v1/traces, partitions spans by traceId,
 * and writes trace-scoped fragments to `traces/{traceId}/traces/{requestId}.json`.
 *
 * @param config - TraceApiHandlerConfig with storage and optional CORS/resolvePath settings
 * @returns H3 event handler
 *
 * @example
 * ```ts
 * import { OTLP_TRACES_WRITE_PATH } from '@playwright-opentelemetry/trace-api';
 *
 * const router = createRouter();
 * // OTLP_TRACES_WRITE_PATH = '/v1/traces'
 * router.post(OTLP_TRACES_WRITE_PATH, createOtlpHandler({ storage }));
 * ```
 */
export function createOtlpHandler(config: TraceApiHandlerConfig): EventHandler {
	const storage = config.storage;

	return defineEventHandler(async (event) => {
		// Handle CORS if configured
		const corsResponse = applyCors(event, config.corsOrigin);
		if (corsResponse) {
			return corsResponse;
		}
		const payload = (await readBody(event)) as OtlpExport;
		const traces = partitionOtlpExportByTraceId(payload);

		// Store each trace group separately
		const storePromises: Promise<void>[] = [];
		for (const [traceId, tracePayload] of traces) {
			const filename = `${Date.now()}-${crypto.randomUUID()}.json`;
			let path = `traces/${traceId}/traces/${filename}`;

			// Apply path resolution if configured
			if (config.resolvePath) {
				path = await config.resolvePath(event, path);
			}

			storePromises.push(
				storage.put(path, JSON.stringify(tracePayload), "application/json"),
			);
		}

		await Promise.all(storePromises);

		return { status: "ok" };
	});
}
