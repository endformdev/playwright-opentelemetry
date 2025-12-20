import type { Request, Route } from "@playwright/test";
import {
	generateSpanId,
	getCurrentSpanId,
	getOrCreateTraceId,
	writeNetworkSpanParent,
} from "../shared/trace-files";

export interface PlaywrightFixturePropagatorOptions {
	route: Route;
	request: Request;
	testId: string;
	outputDir: string;
}

/**
 * Intercepts network requests to propagate trace context via traceparent header.
 * Also records the parent span ID for later correlation by the response handler.
 *
 * This function only:
 * 1. Creates a span ID for the request
 * 2. Injects the traceparent header
 * 3. Writes a parent file with the current parent span ID
 *
 * The actual span data (timing, status, attributes) is captured by
 * fixtureCaptureRequestResponse when the response is received.
 *
 * @param options - The propagator options
 */
export async function fixtureOtelHeaderPropagator({
	route,
	request,
	testId,
	outputDir,
}: PlaywrightFixturePropagatorOptions): Promise<void> {
	// Get or create trace ID for this test
	const traceId = getOrCreateTraceId(outputDir, testId);

	// Get current parent span ID - must exist since test span is always created first
	const parentSpanId = getCurrentSpanId(outputDir, testId);

	// Generate a new span ID for this HTTP request
	const spanId = generateSpanId();

	// Build traceparent header: version-traceid-spanid-flags
	// version: 00, flags: 01 (sampled)
	const traceHeader = `00-${traceId}-${spanId}-01`;

	// Write parent span ID for correlation with response handler
	writeNetworkSpanParent({
		outputDir,
		testId,
		parentSpanId,
		traceHeader,
	});

	// Continue the request with trace propagation headers
	await route.fallback({
		headers: {
			traceparent: traceHeader,
			...request.headers(),
		},
	});
}
