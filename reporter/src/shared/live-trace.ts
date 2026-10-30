import type { ResolvedPlaywrightOpentelemetryDestination } from "./config";

/** Routes served by `@playwright-opentelemetry/trace-api/cloudflare-live`. */
const LIVE_TRACE_PATH_PREFIX = "/playwright-otel-live/v1";

const LIVE_TRACE_REQUEST_TIMEOUT_MS = 3000;

export type LiveTraceRoute = "start" | "spans" | "frames" | "end";

export interface LiveTraceStarted {
	traceId: string;
	rootSpanId: string;
	test: {
		title: string;
		file: string;
		line: number;
		describes: string[];
		project: string;
	};
	/** Epoch milliseconds */
	startTime: number;
}

export interface LiveTraceEnded {
	status: string;
	/** Epoch milliseconds */
	endTime: number;
}

/**
 * Sends one request to a live trace route. Never rejects: live viewing is best
 * effort and must not fail a test, so failures come back as a message.
 */
export async function sendLiveTraceRequest(
	destination: ResolvedPlaywrightOpentelemetryDestination,
	traceId: string,
	route: LiveTraceRoute,
	body: string | Blob,
): Promise<string | undefined> {
	const url = `${destination.url}${LIVE_TRACE_PATH_PREFIX}/${traceId}/${route}`;

	try {
		const response = await fetch(url, {
			method: route === "start" || route === "end" ? "PUT" : "POST",
			headers: {
				"content-type":
					typeof body === "string" ? "application/json" : "application/zip",
				...destination.headers,
			},
			body,
			signal: AbortSignal.timeout(LIVE_TRACE_REQUEST_TIMEOUT_MS),
		});

		if (!response.ok) {
			return `${url}: ${response.status} ${response.statusText}, ${await response.text()}`;
		}
	} catch (error) {
		return `${url}: ${error instanceof Error ? error.message : String(error)}`;
	}
}
