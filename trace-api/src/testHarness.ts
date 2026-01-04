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
import type { TraceStorage } from "./storage/s3";

export interface TestHarnessConfig {
	/**
	 * Transform storage paths before read/write.
	 * Useful for multi-tenancy testing.
	 */
	resolvePath?: (event: H3Event, path: string) => Promise<string> | string;
}

// AsyncLocalStorage to share the current H3Event with the storage layer
const eventContext = new AsyncLocalStorage<H3Event>();

export function createTestHarness(config?: TestHarnessConfig): H3 {
	const baseStorage = createInMemoryStorage();

	// Wrap storage with resolvePath if provided
	const storage = config?.resolvePath
		? createPathResolvingStorage(baseStorage, config.resolvePath, eventContext)
		: baseStorage;

	const app = new H3();

	// Wrap handlers with AsyncLocalStorage context if resolvePath is provided
	if (config?.resolvePath) {
		const otlpHandler = createOtlpHandler(storage);
		const playwrightHandler = createPlaywrightHandler(storage);
		const viewerHandler = createViewerHandler(storage);

		app.post(OTLP_TRACES_WRITE_PATH, (event: H3Event) => {
			return eventContext.run(event, () => otlpHandler(event));
		});
		app.put(PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH, (event: H3Event) => {
			return eventContext.run(event, () => playwrightHandler(event));
		});
		app.get(TRACES_READ_PATH, (event: H3Event) => {
			return eventContext.run(event, () => viewerHandler(event));
		});
	} else {
		app.post(OTLP_TRACES_WRITE_PATH, createOtlpHandler(storage));
		app.put(
			PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH,
			createPlaywrightHandler(storage),
		);
		app.get(TRACES_READ_PATH, createViewerHandler(storage));
	}

	return app;
}

/**
 * Test data helpers
 */

export function generateTraceId(): string {
	return Array.from({ length: 32 }, () =>
		Math.floor(Math.random() * 16).toString(16),
	).join("");
}

export function generateSpanId(): string {
	return Array.from({ length: 16 }, () =>
		Math.floor(Math.random() * 16).toString(16),
	).join("");
}

interface CreateOtlpPayloadOptions {
	traceId: string;
	serviceName?: string;
	spans?: Array<{
		name: string;
		spanId?: string;
		parentSpanId?: string;
		startTimeUnixNano: string;
		endTimeUnixNano: string;
	}>;
}

export function createOtlpPayload(options: CreateOtlpPayloadOptions) {
	const { traceId, serviceName = "playwright", spans = [] } = options;

	return {
		resourceSpans: [
			{
				resource: {
					attributes: [
						{
							key: "service.name",
							value: { stringValue: serviceName },
						},
					],
				},
				scopeSpans: [
					{
						scope: { name: `${serviceName}-instrumentation` },
						spans: spans.map((span) => ({
							traceId,
							spanId: span.spanId || generateSpanId(),
							parentSpanId: span.parentSpanId,
							name: span.name,
							startTimeUnixNano: span.startTimeUnixNano,
							endTimeUnixNano: span.endTimeUnixNano,
							status: { code: 1 },
						})),
					},
				],
			},
		],
	};
}

interface CreateTestJsonOptions {
	traceId: string;
	name: string;
	status: "passed" | "failed" | "timedOut" | "skipped";
	file?: string;
	line?: number;
	describes?: string[];
	startTimeUnixNano?: string;
	endTimeUnixNano?: string;
	error?: {
		message: string;
		stack: string;
	};
}

export function createTestJson(options: CreateTestJsonOptions) {
	const {
		traceId,
		name,
		status,
		file = "tests/example.spec.ts",
		line = 10,
		describes = [],
		startTimeUnixNano = "1766927492000000000",
		endTimeUnixNano = "1766927493000000000",
		error,
	} = options;

	return {
		name,
		describes,
		file,
		line,
		status,
		traceId,
		startTimeUnixNano,
		endTimeUnixNano,
		...(error && { error }),
	};
}

export function createScreenshotBuffer(text = "screenshot"): ArrayBuffer {
	// Simple mock binary data
	return new TextEncoder().encode(`FAKE_JPEG_${text}`).buffer;
}

interface StoredObject {
	data: ArrayBuffer;
	contentType: string;
}

export function createInMemoryStorage(): TraceStorage {
	const store = new Map<string, StoredObject>();

	return {
		async put(path: string, data: string | ArrayBuffer, contentType: string) {
			const buffer =
				typeof data === "string" ? new TextEncoder().encode(data).buffer : data;

			store.set(path, {
				data: buffer,
				contentType,
			});
		},

		async get(path: string): Promise<ArrayBuffer | null> {
			const obj = store.get(path);
			return obj ? obj.data : null;
		},

		async list(prefix: string): Promise<string[]> {
			const results: string[] = [];

			for (const key of store.keys()) {
				if (key.startsWith(prefix)) {
					results.push(key);
				}
			}

			return results.sort();
		},
	};
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
			return results.map((fullPath) => {
				// Remove the tenant prefix to match the expected format
				const prefixToRemove = resolvedPrefix.replace(prefix, "");
				if (fullPath.startsWith(prefixToRemove)) {
					return fullPath.substring(prefixToRemove.length);
				}
				return fullPath;
			});
		},
	};
}
