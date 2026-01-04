import {
	createOtlpHandler,
	createPlaywrightHandler,
	createViewerHandler,
	OTLP_TRACES_WRITE_PATH,
	PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH,
	TRACES_READ_PATH,
} from "@playwright-opentelemetry/trace-api";
import { defineEventHandler, H3, serve } from "h3";

const PORT = 9295;

const traceIds = new Set<string>();

const store = new Map<string, { data: ArrayBuffer; contentType: string }>();

// Create in-memory storage
const storage = {
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

const app = new H3();
app.post(OTLP_TRACES_WRITE_PATH, createOtlpHandler(storage));

const playwrightHandler = createPlaywrightHandler(storage);
app.put(
	PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH,
	defineEventHandler(async (event) => {
		// Extract trace ID from X-Trace-Id header
		const traceId = event.req.headers.get("x-trace-id");
		if (traceId) {
			traceIds.add(traceId);
		}

		return playwrightHandler(event);
	}),
);

app.get(TRACES_READ_PATH, createViewerHandler(storage));

app.get("/trace-ids", () => {
	return { traceIds: Array.from(traceIds).sort() };
});

app.get("/health", () => {
	return { status: "ok" };
});

serve(app, { port: PORT, gracefulShutdown: false });
