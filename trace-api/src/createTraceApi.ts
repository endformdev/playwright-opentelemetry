import { createApp, createRouter, toWebHandler } from "h3";
import type { App, H3Event } from "h3";
import { createS3Storage, type StorageConfig } from "./storage/s3";
import { createOtlpHandler } from "./handlers/otlp";
import { createPlaywrightHandler } from "./handlers/playwright";
import { createViewerHandler } from "./handlers/viewer";

/**
 * Configuration for the high-level createTraceApi factory.
 */
export interface TraceApiConfig {
	/** S3-compatible storage configuration */
	storage: StorageConfig;
	/**
	 * Transform storage paths before read/write.
	 * Useful for multi-tenancy - prefix paths with org ID.
	 */
	resolvePath?: (event: H3Event, path: string) => Promise<string> | string;
}

/**
 * Extended H3 app with a web-standard fetch handler.
 */
export interface TraceApiApp extends App {
	/**
	 * Web-standard fetch handler for use with Cloudflare Workers, Deno, Bun, etc.
	 */
	fetch: (request: Request) => Promise<Response>;
}

/**
 * Create a fully-configured Trace API with sensible defaults.
 *
 * Returns an H3 app with all endpoints configured:
 * - POST /v1/traces - OTLP trace ingestion
 * - PUT /playwright-opentelemetry/** - Playwright test data
 * - GET /traces/** - Trace viewer read API
 *
 * @param config - Trace API configuration
 * @returns H3 app with .fetch method for use in any runtime
 *
 * @example
 * ```ts
 * // Cloudflare Workers
 * const api = createTraceApi({
 *   storage: {
 *     bucket: 'my-traces',
 *     endpoint: 'https://xxx.r2.cloudflarestorage.com',
 *     accessKeyId: env.R2_ACCESS_KEY_ID,
 *     secretAccessKey: env.R2_SECRET_ACCESS_KEY,
 *   },
 * });
 *
 * export default { fetch: api.fetch };
 * ```
 *
 * @example
 * ```ts
 * // With path transformation for multi-tenancy
 * const api = createTraceApi({
 *   storage: { ... },
 *   resolvePath: (event, path) => {
 *     const orgId = event.context.orgId;
 *     return `orgs/${orgId}/${path}`;
 *   },
 * });
 *
 * // Add auth middleware using router
 * ```
 */
export function createTraceApi(config: TraceApiConfig): TraceApiApp {
	const storage = createS3Storage(config.storage);

	// TODO: Wire up resolvePath to create a wrapped storage
	// that transforms paths before operations
	if (config.resolvePath) {
		// biome-ignore lint/suspicious/noConsole: Temporary warning for unimplemented feature
		console.warn(
			"createTraceApi: resolvePath is not yet implemented, paths will not be transformed",
		);
	}

	const app = createApp();
	const router = createRouter();

	// OTLP ingestion endpoint
	router.post("/v1/traces", createOtlpHandler(storage));

	// Playwright-specific endpoints
	router.put("/playwright-opentelemetry/**", createPlaywrightHandler(storage));

	// Trace viewer read endpoints
	router.get("/traces/**", createViewerHandler(storage));

	app.use(router);

	// Create web handler and attach to app
	const webHandler = toWebHandler(app);
	const appWithFetch = app as TraceApiApp;
	appWithFetch.fetch = webHandler;

	return appWithFetch;
}
