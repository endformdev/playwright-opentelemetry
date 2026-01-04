import { H3 } from "h3";
import {
	OTLP_TRACES_WRITE_PATH,
	PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH,
	TRACES_READ_PATH,
} from "./api";
import { createOtlpHandler } from "./handlers/otlp";
import { createPlaywrightHandler } from "./handlers/playwright";
import { createViewerHandler } from "./handlers/viewer";
import type { TraceStorage } from "./storage/s3";

export function createTestHarness(): H3 {
	const storage = createInMemoryStorage();

	const app = new H3();
	app.post(OTLP_TRACES_WRITE_PATH, createOtlpHandler(storage));
	app.put(
		PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH,
		createPlaywrightHandler(storage),
	);
	app.get(TRACES_READ_PATH, createViewerHandler(storage));

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

function createInMemoryStorage(): TraceStorage {
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
