/**
 * A trace API Worker with live traces turned on: the setup a Cloudflare host
 * deploys. The live e2e suite runs it locally with `wrangler dev`.
 *
 * For the e2e suite it also serves a small demo shop for the producer test to
 * click through, and records a server span for every request that carries a
 * `traceparent`. Those spans go through the Worker's own OTLP route, so the
 * shop's requests join the producer's live trace and the viewer's requests
 * join the observer's trace. A live trace stream's span lasts as long as the
 * connection, with an event for every message pushed through it.
 */
import { createTraceApi } from "@playwright-opentelemetry/trace-api";
import {
	createLiveTraceApi,
	createR2Storage,
	LIVE_TRACE_PATH_PREFIX,
	type LiveTraceBucket,
	LiveTraceDurableObject,
	type LiveTraceNamespace,
} from "@playwright-opentelemetry/trace-api/cloudflare-live";

export { LiveTraceDurableObject };

interface Env {
	LIVE_TRACES: LiveTraceNamespace;
	TRACES: LiveTraceBucket;
}

interface ExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
}

type TraceApi = ReturnType<typeof createTraceApi>;

const SERVICE_NAME = "live-trace-api";
const SPAN_KIND_SERVER = 2;
const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const live = createLiveTraceApi({
			namespace: env.LIVE_TRACES,
			frames: env.TRACES,
			corsOrigin: "*",
		});
		// Static traces keep working next to live ones. Spans from services
		// under test reach a live trace through routeSpans.
		const api = createTraceApi({
			storage: createR2Storage(env.TRACES),
			corsOrigin: "*",
			routeSpans: live.routeSpans,
		});

		const startTime = Date.now();
		const response = await route(request, api, live.fetch);

		const parentMatch = TRACEPARENT_PATTERN.exec(
			request.headers.get("traceparent") ?? "",
		);
		if (!parentMatch) return response;

		const parent = { traceId: parentMatch[1], parentSpanId: parentMatch[2] };
		const exportSpan = (events: SpanEvent[] = []) =>
			exportServerSpan(api, request, response, startTime, parent, events);

		if (
			response.body &&
			response.headers.get("content-type")?.startsWith("text/event-stream")
		) {
			const { body, closed } = recordStreamEvents(response.body);
			ctx.waitUntil(closed.then(exportSpan));
			return new Response(body, response);
		}

		ctx.waitUntil(exportSpan());
		return response;
	},
};

interface SpanEvent {
	name: string;
	timeUnixNano: string;
	attributes: Attribute[];
}

interface Attribute {
	key: string;
	value:
		| { stringValue: string }
		| { intValue: number }
		| { arrayValue: { values: { stringValue: string }[] } };
}

/**
 * Passes a Server-Sent Events stream through, recording an event for each
 * message. Resolves with them once the trace ends, the stream ends, or the
 * client leaves, whichever comes first. The stream itself stays open after
 * the trace ends, for late spans, but `wrangler dev` doesn't always pass on a
 * client leaving, so the span ends with the trace.
 */
function recordStreamEvents(source: ReadableStream<Uint8Array>): {
	body: ReadableStream<Uint8Array>;
	closed: Promise<SpanEvent[]>;
} {
	const events: SpanEvent[] = [];
	const decoder = new TextDecoder();
	const reader = source.getReader();
	let buffered = "";
	let finish!: () => void;
	const closed = new Promise<SpanEvent[]>((resolve) => {
		finish = () => resolve(events);
	});

	const record = (chunk: Uint8Array) => {
		buffered += decoder.decode(chunk, { stream: true });
		const messages = buffered.split("\n\n");
		buffered = messages.pop() ?? "";
		for (const message of messages) {
			const event = streamMessageEvent(message);
			if (!event) continue;
			events.push(event);
			if (event.name === "trace.ended") finish();
		}
	};

	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			const { done, value } = await reader.read();
			if (done) {
				controller.close();
				finish();
				return;
			}
			record(value);
			controller.enqueue(value);
		},
		cancel(reason) {
			finish();
			return reader.cancel(reason);
		},
	});

	return { body, closed };
}

/** One SSE message as a span event; comments such as heartbeats are skipped. */
function streamMessageEvent(message: string): SpanEvent | undefined {
	const fields = new Map<string, string>();
	for (const line of message.split("\n")) {
		const separator = line.indexOf(": ");
		if (separator > 0)
			fields.set(line.slice(0, separator), line.slice(separator + 2));
	}
	const type = fields.get("event");
	const data = fields.get("data");
	if (!type || !data) return undefined;

	const attributes: Attribute[] = [
		stringAttribute("sse.event.id", fields.get("id") ?? ""),
		{ key: "sse.data.bytes", value: { intValue: data.length } },
	];
	const payload = JSON.parse(data) as {
		resourceSpans?: { scopeSpans?: { spans?: { name: string }[] }[] }[];
		file?: string;
		status?: string;
	};
	const spanNames = (payload.resourceSpans ?? []).flatMap((resourceSpan) =>
		(resourceSpan.scopeSpans ?? []).flatMap((scopeSpan) =>
			(scopeSpan.spans ?? []).map((span) => span.name),
		),
	);
	if (spanNames.length > 0) {
		attributes.push(
			{ key: "live_trace.span_count", value: { intValue: spanNames.length } },
			{
				key: "live_trace.span_names",
				value: {
					arrayValue: {
						values: spanNames.map((name) => ({ stringValue: name })),
					},
				},
			},
		);
	}
	if (payload.file)
		attributes.push(stringAttribute("live_trace.frames_file", payload.file));
	if (payload.status)
		attributes.push(stringAttribute("test.status", payload.status));

	return {
		name: spanNames.length > 0 ? `${type} (${spanNames.length})` : type,
		timeUnixNano: toNanos(Date.now()),
		attributes,
	};
}

async function route(
	request: Request,
	api: TraceApi,
	live: (request: Request) => Promise<Response>,
): Promise<Response> {
	const { pathname } = new URL(request.url);

	if (pathname === "/health") return new Response("ok");
	if (pathname.startsWith("/demo/")) return demoShop(request, pathname);
	if (pathname.startsWith(LIVE_TRACE_PATH_PREFIX)) return live(request);
	return api.fetch(request);
}

/** A two-button shop whose buttons call the Worker, so they make spans. */
async function demoShop(request: Request, pathname: string): Promise<Response> {
	switch (`${request.method} ${pathname}`) {
		case "GET /demo/shop":
			return new Response(SHOP_HTML, {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		case "POST /demo/api/cart":
			return Response.json({ items: 1 });
		case "POST /demo/api/checkout":
			// Long enough to stand out on the timeline.
			await new Promise((resolve) => setTimeout(resolve, 300));
			return Response.json({ orderId: "order-1" });
		default:
			return new Response("Not found", { status: 404 });
	}
}

const SHOP_HTML = `<!doctype html>
<html>
<head><title>Demo shop</title></head>
<body style="font-family: sans-serif; padding: 2rem; background: #dbeafe">
	<h1>Demo shop</h1>
	<p id="cart">Cart is empty</p>
	<button id="add">Add to cart</button>
	<button id="checkout" disabled>Check out</button>
	<script>
		const cart = document.getElementById("cart");
		document.getElementById("add").onclick = async () => {
			const { items } = await (await fetch("/demo/api/cart", { method: "POST" })).json();
			cart.textContent = items + " item in cart";
			document.body.style.background = "#fef3c7";
			document.getElementById("checkout").disabled = false;
		};
		document.getElementById("checkout").onclick = async () => {
			const { orderId } = await (await fetch("/demo/api/checkout", { method: "POST" })).json();
			cart.textContent = "Order placed: " + orderId;
			document.body.style.background = "#dcfce7";
		};
	</script>
</body>
</html>`;

/** Records one server span for a request, through the Worker's own OTLP route. */
async function exportServerSpan(
	api: TraceApi,
	request: Request,
	response: Response,
	startTime: number,
	parent: { traceId: string; parentSpanId: string },
	events: SpanEvent[],
): Promise<void> {
	const url = new URL(request.url);
	const httpRoute = routeTemplate(url.pathname);
	const span = {
		traceId: parent.traceId,
		spanId: randomHex(8),
		parentSpanId: parent.parentSpanId,
		name: `${request.method} ${httpRoute}`,
		kind: SPAN_KIND_SERVER,
		startTimeUnixNano: toNanos(startTime),
		endTimeUnixNano: toNanos(Math.max(Date.now(), startTime + 1)),
		attributes: [
			stringAttribute("http.request.method", request.method),
			stringAttribute("http.route", httpRoute),
			stringAttribute("url.path", url.pathname),
			{
				key: "http.response.status_code",
				value: { intValue: response.status },
			},
		],
		events,
		links: [],
		status: { code: response.status >= 500 ? 2 : 0 },
	};

	await api.fetch(
		new Request("http://live-trace-api/v1/traces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				resourceSpans: [
					{
						resource: {
							attributes: [stringAttribute("service.name", SERVICE_NAME)],
						},
						scopeSpans: [
							{
								scope: { name: "live-trace-worker", version: "1" },
								spans: [span],
							},
						],
					},
				],
			}),
		}),
	);
}

function routeTemplate(pathname: string): string {
	return pathname
		.replace(/\/[0-9a-f]{32}(?=\/|$)/, "/:traceId")
		.replace(/\/frames\/[^/]+\.zip$/, "/frames/:file");
}

function stringAttribute(key: string, value: string): Attribute {
	return { key, value: { stringValue: value } };
}

function toNanos(ms: number): string {
	return (BigInt(ms) * 1_000_000n).toString();
}

function randomHex(bytes: number): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}
