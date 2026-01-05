import { H3, type H3Event } from "h3";
import {
	OTLP_TRACES_WRITE_PATH,
	PLAYWRIGHT_REPORTER_WRITE_PATH,
	TRACE_VIEWER_READ_PATH,
} from "./api";
import { createOtlpHandler } from "./handlers/otlp";
import { createPlaywrightHandler } from "./handlers/playwright";
import { createViewerHandler } from "./handlers/viewer";
import {
	createS3Storage,
	type StorageConfig,
	type TraceStorage,
} from "./storage/s3";

export interface TraceApiConfig {
	/**
	 * TraceStorage implementation for storing traces.
	 * Use with a custom storage implementation or createS3Storage().
	 */
	storage?: TraceStorage;
	/**
	 * S3 storage configuration. If provided, S3 storage will be created automatically.
	 * Use this OR storage, not both.
	 */
	storageConfig?: StorageConfig;
	/**
	 * Transform storage paths before read/write.
	 */
	resolvePath?: (event: H3Event, path: string) => Promise<string> | string;
	/**
	 * CORS origin setting. Defaults to false (disabled).
	 * Set to "*" or a specific origin string to enable CORS.
	 */
	corsOrigin?: string | false;
}

/**
 * Configuration for trace API handlers with required storage.
 * This is what handlers actually receive after storage is resolved.
 */
export interface TraceApiHandlerConfig {
	/**
	 * TraceStorage implementation for storing traces.
	 */
	storage: TraceStorage;
	/**
	 * Transform storage paths before read/write.
	 */
	resolvePath?: (event: H3Event, path: string) => Promise<string> | string;
	/**
	 * CORS origin setting. Defaults to false (disabled).
	 * Set to "*" or a specific origin string to enable CORS.
	 */
	corsOrigin?: string | false;
}

/**
 * Create a fully-configured Trace API with sensible defaults.
 *
 * Returns an H3 app with all endpoints configured:
 * - POST /v1/traces - OTLP trace ingestion
 * - PUT /otel-playwright-reporter/** - Playwright test data
 * - GET /otel-trace-viewer/** - Trace viewer read API
 *
 */
export function createTraceApi(config: TraceApiConfig): H3 {
	// Determine storage: either use provided storage or create from storageConfig
	if (!config.storage && !config.storageConfig) {
		throw new Error(
			"Either storage or storageConfig must be provided to createTraceApi",
		);
	}

	const storage = config.storage ?? createS3Storage(config.storageConfig!);

	const handlerConfig: TraceApiHandlerConfig = {
		storage,
		resolvePath: config.resolvePath,
		corsOrigin: config.corsOrigin,
	};

	const h3 = new H3();

	h3.post(OTLP_TRACES_WRITE_PATH, createOtlpHandler(handlerConfig));
	h3.put(
		PLAYWRIGHT_REPORTER_WRITE_PATH,
		createPlaywrightHandler(handlerConfig),
	);
	h3.get(TRACE_VIEWER_READ_PATH, createViewerHandler(handlerConfig));

	return h3;
}
