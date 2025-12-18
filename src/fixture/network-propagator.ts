import type { Route } from "@playwright/test";
import {
	generateSpanId,
	getCurrentSpanId,
	getOrCreateTraceId,
	type NetworkSpan,
	writeNetworkSpan,
} from "../shared/trace-files";

export interface PlaywrightFixturePropagatorOptions {
	testId: string;
	outputDir: string;
	route: Route;
}

/**
 * OpenTelemetry SpanKind values
 * @see https://opentelemetry.io/docs/specs/otel/trace/api/#spankind
 */
const SPAN_KIND_CLIENT = 3;

/**
 * OpenTelemetry SpanStatusCode values
 * @see https://opentelemetry.io/docs/specs/otel/trace/api/#set-status
 */
const SPAN_STATUS_CODE_UNSET = 0;
const SPAN_STATUS_CODE_ERROR = 2;

/**
 * Intercepts network requests to:
 * 1. Propagate trace context via traceparent header
 * 2. Create HTTP client spans for the trace
 *
 * @param options - The propagator options
 */
export async function playwrightFixturePropagator({
	route,
	testId,
	outputDir,
}: PlaywrightFixturePropagatorOptions): Promise<void> {
	const request = route.request();
	const url = request.url();
	const method = request.method();

	// Get or create trace ID for this test
	const traceId = await getOrCreateTraceId(outputDir, testId);

	// Get current parent span ID (may be undefined if called before reporter pushes context)
	// This is synchronous for reliability
	const parentSpanId = getCurrentSpanId(outputDir, testId);

	// Generate a new span ID for this HTTP request
	const spanId = generateSpanId();

	// Build traceparent header: version-traceid-spanid-flags
	// version: 00, flags: 01 (sampled)
	const traceparent = `00-${traceId}-${spanId}-01`;

	// Record start time
	const startTime = new Date();

	// Continue the request with trace propagation headers
	let response: Awaited<ReturnType<Route["fetch"]>> | undefined;
	let error: Error | undefined;
	let routeHandled = false;

	try {
		// Use route.fetch() to make the request and get the response
		response = await route.fetch({
			headers: {
				traceparent,
			},
		});

		// Fulfill the route with the fetched response
		await route.fulfill({ response });
		routeHandled = true;
	} catch (err) {
		error = err as Error;
		// If fetch/fulfill fails and route not yet handled, continue the original request
		if (!routeHandled) {
			try {
				await route.continue({
					headers: {
						...Object.fromEntries(
							request.headers ? Object.entries(request.headers()) : [],
						),
						traceparent,
					},
				});
			} catch {
				// Route might already be handled, ignore
			}
		}
	}

	// Record end time
	const endTime = new Date();

	// Parse URL for attributes
	const parsedUrl = new URL(url);
	const serverAddress = parsedUrl.hostname;
	const serverPort =
		parsedUrl.port !== ""
			? Number.parseInt(parsedUrl.port, 10)
			: parsedUrl.protocol === "https:"
				? 443
				: 80;

	// Get response status code if available
	const statusCode = response?.status();

	// Determine span status based on response
	// For HTTP client spans: 4xx and 5xx should be ERROR
	let statusCodeValue = SPAN_STATUS_CODE_UNSET;
	if (error || (statusCode && statusCode >= 400)) {
		statusCodeValue = SPAN_STATUS_CODE_ERROR;
	}

	// Build attributes following OpenTelemetry HTTP semantic conventions
	const attributes: Record<string, string | number | boolean> = {
		"http.request.method": method,
		"url.full": url,
		"server.address": serverAddress,
		"server.port": serverPort,
	};

	if (statusCode !== undefined) {
		attributes["http.response.status_code"] = statusCode;
	}

	if (statusCodeValue === SPAN_STATUS_CODE_ERROR) {
		// error.type SHOULD be set to the status code as a string for HTTP errors
		attributes["error.type"] = statusCode?.toString() ?? error?.name ?? "Error";
	}

	// Create the network span
	const networkSpan: NetworkSpan = {
		traceId,
		spanId,
		parentSpanId: parentSpanId ?? spanId, // If no parent, use self (will be re-parented by reporter)
		name: `HTTP ${method}`,
		kind: SPAN_KIND_CLIENT,
		startTime,
		endTime,
		status: { code: statusCodeValue },
		attributes,
	};

	// Write span to file for reporter to collect
	await writeNetworkSpan(outputDir, testId, networkSpan);
}
