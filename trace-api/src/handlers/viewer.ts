import type { EventHandler } from "h3";
import { defineEventHandler, getRouterParam, HTTPError } from "h3";
import { applyCors } from "../cors";
import type { TraceApiHandlerConfig } from "../createTraceApi";
import { type OtlpExport, mergeOtlpExports } from "../otlp";

/**
 * Create a handler for the trace viewer read API.
 *
 * Serves trace data in the format expected by the trace viewer:
 * - GET /playwright-otel-trace-viewer/v1/{traceId}/traces -> { resourceSpans: [...] }
 * - GET /playwright-otel-trace-viewer/v1/{traceId}/screenshots.zip
 *
 * @param config - TraceApiHandlerConfig with storage and optional CORS/resolvePath settings
 * @returns H3 event handler
 *
 * @example
 * ```ts
 * import { TRACE_VIEWER_READ_PATH } from '@playwright-opentelemetry/trace-api';
 *
 * const router = createRouter();
 * // TRACE_VIEWER_READ_PATH = '/playwright-otel-trace-viewer/v1/**'
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
		// Get the full path after /playwright-otel-trace-viewer/v1/
		const path = getRouterParam(event, "_");
		if (!path) {
			throw new HTTPError({ statusCode: 404, message: "Path is required" });
		}

		const parts = path.split("/");
		const traceId = parts[0];

		if (parts.length === 2 && parts[1] === "traces") {
			const prefix = `traces/${traceId}/traces/`;

			// Apply path resolution if configured
			let resolvedPrefix = prefix;
			if (config.resolvePath) {
				resolvedPrefix = await config.resolvePath(event, prefix);
			}

			const files = (await storage.list(resolvedPrefix)).filter((file) =>
				file.endsWith(".json"),
			);

			if (files.length === 0) {
				throw new HTTPError({
					statusCode: 404,
					message: `Trace not found: ${traceId}`,
				});
			}

			const payloads = await Promise.all(
				files.map(async (file) => {
					const data = await storage.get(file);
					if (!data) {
						throw new HTTPError({
							statusCode: 500,
							message: `Listed trace fragment could not be loaded: ${file}`,
						});
					}
					const text = new TextDecoder().decode(data);
					return JSON.parse(text) as OtlpExport;
				}),
			);

			return mergeOtlpExports(payloads);
		}

		if (parts.length === 2 && parts[1] === "screenshots.zip") {
			let storagePath = `traces/${traceId}/screenshots.zip`;

			// Apply path resolution if configured
			if (config.resolvePath) {
				storagePath = await config.resolvePath(event, storagePath);
			}

			const data = await storage.get(storagePath);

			if (!data) {
				throw new HTTPError({
					statusCode: 404,
					message: `Screenshots ZIP not found: ${traceId}`,
				});
			}

			return new Response(data, {
				headers: {
					"Content-Type": "application/zip",
					"Cache-Control": "public, max-age=600",
				},
			});
		}

		throw new HTTPError({
			statusCode: 404,
			message: `Unsupported path: ${path}`,
		});
	});
}
