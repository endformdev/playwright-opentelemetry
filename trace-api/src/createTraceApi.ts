import { AsyncLocalStorage } from "node:async_hooks";
import { H3, type H3Event } from "h3";
import {
	OTLP_TRACES_WRITE_PATH,
	PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH,
	TRACES_READ_PATH,
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
	storage: StorageConfig;
	/**
	 * Transform storage paths before read/write.
	 */
	resolvePath?: (event: H3Event, path: string) => Promise<string> | string;
}

// AsyncLocalStorage to share the current H3Event with the storage layer
const eventContext = new AsyncLocalStorage<H3Event>();

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
	const baseStorage = createS3Storage(config.storage);

	// Wrap storage with resolvePath if provided
	const storage = config.resolvePath
		? createPathResolvingStorage(baseStorage, config.resolvePath, eventContext)
		: baseStorage;

	const h3 = new H3();

	// Wrap handlers with AsyncLocalStorage context if resolvePath is provided
	if (config.resolvePath) {
		const otlpHandler = createOtlpHandler(storage);
		const playwrightHandler = createPlaywrightHandler(storage);
		const viewerHandler = createViewerHandler(storage);

		h3.post(OTLP_TRACES_WRITE_PATH, (event: H3Event) => {
			return eventContext.run(event, () => otlpHandler(event));
		});
		h3.put(PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH, (event: H3Event) => {
			return eventContext.run(event, () => playwrightHandler(event));
		});
		h3.get(TRACES_READ_PATH, (event: H3Event) => {
			return eventContext.run(event, () => viewerHandler(event));
		});
	} else {
		h3.post(OTLP_TRACES_WRITE_PATH, createOtlpHandler(storage));
		h3.put(
			PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH,
			createPlaywrightHandler(storage),
		);
		h3.get(TRACES_READ_PATH, createViewerHandler(storage));
	}

	return h3;
}

/**
 * Create a storage wrapper that transforms paths using resolvePath.
 * Uses AsyncLocalStorage to access the current H3Event from the request context.
 */
function createPathResolvingStorage(
	baseStorage: TraceStorage,
	resolvePath: (event: H3Event, path: string) => Promise<string> | string,
	eventStore: AsyncLocalStorage<H3Event>,
): TraceStorage {
	return {
		async put(path: string, data: string | ArrayBuffer, contentType: string) {
			const event = eventStore.getStore();
			if (!event) {
				throw new Error("No event context available for path resolution");
			}
			const resolvedPath = await resolvePath(event, path);
			return baseStorage.put(resolvedPath, data, contentType);
		},

		async get(path: string): Promise<ArrayBuffer | null> {
			const event = eventStore.getStore();
			if (!event) {
				throw new Error("No event context available for path resolution");
			}
			const resolvedPath = await resolvePath(event, path);
			return baseStorage.get(resolvedPath);
		},

		async list(prefix: string): Promise<string[]> {
			const event = eventStore.getStore();
			if (!event) {
				throw new Error("No event context available for path resolution");
			}
			const resolvedPrefix = await resolvePath(event, prefix);
			const results = await baseStorage.list(resolvedPrefix);

			// Strip the resolved prefix to return relative paths
			// This ensures the viewer API returns paths relative to the trace
			return results.map((fullPath) => {
				const prefixToRemove = resolvedPrefix.replace(prefix, "");
				if (fullPath.startsWith(prefixToRemove)) {
					return fullPath.substring(prefixToRemove.length);
				}
				return fullPath;
			});
		},
	};
}
