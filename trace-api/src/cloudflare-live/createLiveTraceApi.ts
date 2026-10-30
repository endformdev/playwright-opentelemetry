import {
	defineEventHandler,
	type EventHandler,
	getRouterParam,
	H3,
	type H3Event,
} from "h3";
import { applyCors } from "../cors";
import type { TraceApiConfig } from "../createTraceApi";
import { type OtlpExport, partitionOtlpExportByTraceId } from "../otlp";
import type {
	LiveTraceEnded,
	LiveTraceSettings,
	LiveTraceStarted,
} from "./LiveTraceDurableObject";

export const LIVE_TRACE_PATH_PREFIX = "/playwright-otel-live/v1";

// The parts of the Cloudflare bindings this module uses. Declared here so the
// package doesn't depend on Cloudflare's global types.
export interface LiveTraceNamespace {
	idFromName(name: string): unknown;
	get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export interface LiveTraceBucket {
	put(
		key: string,
		value: ArrayBuffer | string,
		options?: { httpMetadata?: { contentType?: string } },
	): Promise<unknown>;
	get(key: string): Promise<{
		body: ReadableStream;
		arrayBuffer(): Promise<ArrayBuffer>;
	} | null>;
	head(key: string): Promise<unknown>;
	list(options?: { prefix?: string; cursor?: string }): Promise<{
		objects: { key: string }[];
		truncated: boolean;
		cursor?: string;
	}>;
}

export interface LiveTraceApiConfig {
	/** Durable Object namespace bound to `LiveTraceDurableObject` */
	namespace: LiveTraceNamespace;
	/** R2 bucket for screenshot frame batches */
	frames: LiveTraceBucket;
	/**
	 * Name of the Durable Object and R2 prefix for a trace. Defaults to the
	 * trace ID; prefix it to keep tenants apart.
	 */
	resolveName?: (event: H3Event, traceId: string) => Promise<string> | string;
	corsOrigin?: string | false;
	settings?: Partial<LiveTraceSettings>;
}

export interface LiveTraceApi {
	/** Serves the live routes under /playwright-otel-live/v1 */
	fetch: (request: Request) => Promise<Response>;
	/**
	 * Pass to createTraceApi so spans from services under test reach the live
	 * trace they belong to.
	 */
	routeSpans: NonNullable<TraceApiConfig["routeSpans"]>;
}

const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/i;
const FRAMES_FILE_PATTERN = /^[\w-]+\.zip$/;

/**
 * Create the routes for live traces:
 *
 * - PUT  /playwright-otel-live/v1/{traceId}/start - create the trace
 * - POST /playwright-otel-live/v1/{traceId}/spans - append completed spans (OTLP JSON)
 * - POST /playwright-otel-live/v1/{traceId}/frames - append a screenshot batch (ZIP)
 * - PUT  /playwright-otel-live/v1/{traceId}/end - record the final status
 * - GET  /playwright-otel-live/v1/{traceId}/stream - Server-Sent Events from ?offset=
 * - GET  /playwright-otel-live/v1/{traceId}/traces - every span so far (OTLP JSON)
 * - GET  /playwright-otel-live/v1/{traceId}/frames/{file} - one screenshot batch
 */
export function createLiveTraceApi(config: LiveTraceApiConfig): LiveTraceApi {
	const app = new H3();

	const stubFor = async (event: H3Event, traceId: string) => {
		const name = await resolveName(event, traceId);
		return config.namespace.get(config.namespace.idFromName(name));
	};

	const resolveName = async (event: H3Event, traceId: string) =>
		config.resolveName ? config.resolveName(event, traceId) : traceId;

	const route = (
		handler: (event: H3Event, traceId: string) => Promise<Response>,
	) =>
		liveHandler(config.corsOrigin, async (event) => {
			const traceId = getRouterParam(event, "traceId") ?? "";
			if (!TRACE_ID_PATTERN.test(traceId)) {
				return new Response("Invalid trace ID", { status: 400 });
			}
			return handler(event, traceId.toLowerCase());
		});

	app.put(
		`${LIVE_TRACE_PATH_PREFIX}/:traceId/start`,
		route(async (event, traceId) => {
			const started = (await event.req.json()) as LiveTraceStarted;
			const stub = await stubFor(event, traceId);
			return stub.fetch(
				jsonRequest("PUT", "/start", {
					started: { ...started, traceId },
					settings: config.settings,
				}),
			);
		}),
	);

	app.post(
		`${LIVE_TRACE_PATH_PREFIX}/:traceId/spans`,
		route(async (event, traceId) => {
			const payload = (await event.req.json()) as OtlpExport;
			const tracePayload = partitionOtlpExportByTraceId(payload).get(traceId);
			if (!tracePayload) return Response.json({ accepted: true });

			const stub = await stubFor(event, traceId);
			return stub.fetch(jsonRequest("POST", "/spans?trusted=1", tracePayload));
		}),
	);

	app.post(
		`${LIVE_TRACE_PATH_PREFIX}/:traceId/frames`,
		route(async (event, traceId) => {
			const file = `${Date.now()}-${crypto.randomUUID()}.zip`;
			const name = await resolveName(event, traceId);
			await config.frames.put(
				framesKey(name, file),
				await event.req.arrayBuffer(),
				{ httpMetadata: { contentType: "application/zip" } },
			);

			const stub = await stubFor(event, traceId);
			return stub.fetch(jsonRequest("POST", "/frames", { file }));
		}),
	);

	app.put(
		`${LIVE_TRACE_PATH_PREFIX}/:traceId/end`,
		route(async (event, traceId) => {
			const ended = (await event.req.json()) as LiveTraceEnded;
			const stub = await stubFor(event, traceId);
			return stub.fetch(jsonRequest("PUT", "/end", ended));
		}),
	);

	app.get(
		`${LIVE_TRACE_PATH_PREFIX}/:traceId/stream`,
		route(async (event, traceId) => {
			const offset = new URL(event.req.url).searchParams.get("offset");
			const headers = new Headers();
			const lastEventId = event.req.headers.get("last-event-id");
			if (lastEventId) headers.set("last-event-id", lastEventId);

			const stub = await stubFor(event, traceId);
			return stub.fetch(
				new Request(
					`https://live-trace/stream?offset=${encodeURIComponent(offset ?? "-1")}`,
					{ headers, signal: event.req.signal },
				),
			);
		}),
	);

	app.get(
		`${LIVE_TRACE_PATH_PREFIX}/:traceId/traces`,
		route(async (event, traceId) => {
			const stub = await stubFor(event, traceId);
			return stub.fetch(new Request("https://live-trace/traces"));
		}),
	);

	app.get(
		`${LIVE_TRACE_PATH_PREFIX}/:traceId/frames/:file`,
		route(async (event, traceId) => {
			const file = getRouterParam(event, "file") ?? "";
			if (!FRAMES_FILE_PATTERN.test(file)) {
				return new Response("Invalid frames file", { status: 400 });
			}

			const name = await resolveName(event, traceId);
			const object = await config.frames.get(framesKey(name, file));
			if (!object) return new Response("Not found", { status: 404 });

			return new Response(object.body, {
				headers: {
					"content-type": "application/zip",
					// Batches never change once written.
					"cache-control": "private, max-age=31536000, immutable",
				},
			});
		}),
	);

	return {
		fetch: (request) => Promise.resolve(app.fetch(request)),
		routeSpans: async (event, traceId, payload) => {
			const stub = await stubFor(event, traceId);
			const response = await stub.fetch(jsonRequest("POST", "/spans", payload));
			if (!response.ok) return false;
			const { accepted } = (await response.json()) as { accepted: boolean };
			return accepted;
		},
	};
}

function framesKey(name: string, file: string): string {
	return `live/${name}/frames/${file}`;
}

function jsonRequest(method: string, path: string, body: unknown): Request {
	return new Request(`https://live-trace${path}`, {
		method,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

/**
 * Responses from the Durable Object are passed through, so CORS headers are
 * added to them here rather than through the H3 event.
 */
function liveHandler(
	corsOrigin: string | false | undefined,
	handler: (event: H3Event) => Promise<Response>,
): EventHandler {
	return defineEventHandler(async (event) => {
		const corsResponse = applyCors(event, corsOrigin);
		if (corsResponse) return corsResponse;

		const response = await handler(event);
		if (!corsOrigin) return response;

		const headers = new Headers(response.headers);
		headers.set("access-control-allow-origin", corsOrigin);
		return new Response(response.body, {
			status: response.status,
			headers,
		});
	});
}
