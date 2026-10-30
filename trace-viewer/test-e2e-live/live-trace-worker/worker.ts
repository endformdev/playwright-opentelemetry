/**
 * A trace API Worker with live traces turned on: the setup a Cloudflare host
 * deploys. The live e2e suite runs it locally with `wrangler dev`.
 *
 * For the e2e suite it also serves a small demo shop for the producer test to
 * click through, and records a server span for every request that carries a
 * `traceparent`. Those spans go through the Worker's own OTLP route, so the
 * shop's requests join the producer's live trace and the viewer's requests
 * join the observer's trace.
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

		const parent = TRACEPARENT_PATTERN.exec(
			request.headers.get("traceparent") ?? "",
		);
		if (parent) {
			ctx.waitUntil(
				exportServerSpan(api, request, response, startTime, {
					traceId: parent[1],
					parentSpanId: parent[2],
				}),
			);
		}

		return response;
	},
};

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

/**
 * Records one server span for a request, through the Worker's own OTLP route.
 * Streaming responses end when their headers are sent, not when the stream
 * closes.
 */
async function exportServerSpan(
	api: TraceApi,
	request: Request,
	response: Response,
	startTime: number,
	parent: { traceId: string; parentSpanId: string },
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
		events: [],
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

function stringAttribute(key: string, value: string) {
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
