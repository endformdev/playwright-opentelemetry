import { H3, type H3Event } from "h3";
import {
	OTLP_TRACES_WRITE_PATH,
	PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH,
	TRACES_READ_PATH,
} from "./api";
import { createOtlpHandler } from "./handlers/otlp";
import { createPlaywrightHandler } from "./handlers/playwright";
import { createViewerHandler } from "./handlers/viewer";
import { createS3Storage, type StorageConfig } from "./storage/s3";

export interface TraceApiConfig {
	storage: StorageConfig;
	/**
	 * Transform storage paths before read/write.
	 */
	resolvePath?: (event: H3Event, path: string) => Promise<string> | string;
}

/**
 * Create a fully-configured Trace API with sensible defaults.
 *
 * Returns an H3 app with all endpoints configured:
 * - POST /v1/traces - OTLP trace ingestion
 * - PUT /playwright-opentelemetry/** - Playwright test data
 * - GET /traces/** - Trace viewer read API
 *
 */
export function createTraceApi(config: TraceApiConfig): H3 {
	const storage = createS3Storage(config.storage);

	// TODO: Wire up resolvePath to create a wrapped storage
	// that transforms paths before operations
	if (config.resolvePath) {
		console.warn(
			"createTraceApi: resolvePath is not yet implemented, paths will not be transformed",
		);
	}

	const h3 = new H3();

	h3.post(OTLP_TRACES_WRITE_PATH, createOtlpHandler(storage));
	h3.put(PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH, createPlaywrightHandler(storage));
	h3.get(TRACES_READ_PATH, createViewerHandler(storage));

	return h3;
}
