import type { EventHandler } from "h3";
import { defineEventHandler, getRouterParam, HTTPError } from "h3";
import { applyCors } from "../cors";
import type { TraceApiHandlerConfig } from "../createTraceApi";
import { type OtlpExport, mergeOtlpExports } from "../otlp";

/**
 * Create a handler for the trace viewer read API.
 *
 * Serves trace data in the format expected by the trace viewer:
 * - GET /playwright-otel-trace-viewer/{traceId}/traces -> { resourceSpans: [...] }
 * - GET /playwright-otel-trace-viewer/{traceId}/screenshots -> { screenshots: [...] }
 * - GET /playwright-otel-trace-viewer/{traceId}/screenshots/{filename}
 *
 * @param config - TraceApiHandlerConfig with storage and optional CORS/resolvePath settings
 * @returns H3 event handler
 *
 * @example
 * ```ts
 * import { TRACE_VIEWER_READ_PATH } from '@playwright-opentelemetry/trace-api';
 *
 * const router = createRouter();
 * // TRACE_VIEWER_READ_PATH = '/playwright-otel-trace-viewer/**'
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
		// Get the full path after /playwright-otel-trace-viewer/
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

		if (parts.length === 2 && parts[1] === "screenshots") {
			// List all screenshots
			const prefix = `traces/${traceId}/screenshots/`;

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

		if (parts.length === 3 && parts[1] === "screenshots") {
			let storagePath = `traces/${traceId}/screenshots/${parts[2]}`;

			// Apply path resolution if configured
			if (config.resolvePath) {
				storagePath = await config.resolvePath(event, storagePath);
			}

			const data = await storage.get(storagePath);

			if (!data) {
				throw new HTTPError({
					statusCode: 404,
					message: `File not found: ${storagePath}`,
				});
			}

			return new Response(data, {
				headers: {
					"Content-Type": "image/jpeg",
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
