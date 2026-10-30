/**
 * A trace API Worker with live traces turned on: the setup a Cloudflare host
 * deploys. The e2e tests run it locally with `wrangler dev`.
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

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname === "/health") return new Response("ok");

		const live = createLiveTraceApi({
			namespace: env.LIVE_TRACES,
			frames: env.TRACES,
			corsOrigin: "*",
		});
		if (pathname.startsWith(LIVE_TRACE_PATH_PREFIX)) {
			return live.fetch(request);
		}

		// Static traces keep working next to live ones. Spans from services
		// under test reach a live trace through routeSpans.
		const api = createTraceApi({
			storage: createR2Storage(env.TRACES),
			corsOrigin: "*",
			routeSpans: live.routeSpans,
		});
		return api.fetch(request);
	},
};
