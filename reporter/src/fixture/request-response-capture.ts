import type { Request, Response } from "@playwright/test";
import {
	type NetworkSpan,
	readNetworkSpanParent,
	writeNetworkSpan,
} from "../shared/trace-files";

export interface FixtureCaptureOptions {
	request: Request;
	response: Response;
	testId: string;
	outputDir: string;
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
 * Captures request/response data and writes the complete network span.
 * Called from page.on("response") after the request has completed.
 *
 * This function:
 * 1. Extracts the traceparent header to find the parent file
 * 2. Reads the parent span ID from the parent file
 * 3. Builds the complete span with all HTTP attributes
 * 4. Writes the network span for the reporter to collect
 *
 * @param options - The capture options
 */
export async function fixtureCaptureRequestResponse({
	request,
	response,
	testId,
	outputDir,
}: FixtureCaptureOptions): Promise<void> {
	const url = request.url();
	const method = request.method();
	const statusCode = response.status();

	// Get the traceparent header that was injected by the propagator
	const traceHeader = await request.headerValue("traceparent");

	if (!traceHeader) {
		throw new Error(`No traceparent header found for request ${request.url()}`);
	}

	// Read the parent span ID from the parent file
	const parentSpanId = readNetworkSpanParent(outputDir, testId, traceHeader);

	if (!parentSpanId) {
		throw new Error(`No parent span ID found for trace header ${traceHeader}`);
	}

	// Parse the traceparent header to extract traceId and spanId
	// Format: version-traceid-spanid-flags (e.g., "00-abc123...-def456...-01")
	const parts = traceHeader.split("-");
	if (parts.length !== 4) {
		return;
	}
	const [, traceId, spanId] = parts;

	// Get timing information from the request
	// Playwright's timing() provides:
	// - startTime: absolute timestamp in ms since epoch
	// - responseEnd: relative to startTime in ms, -1 if not available
	const timing = request.timing();
	const startTime = new Date(timing.startTime);
	const endTime =
		timing.responseEnd >= 0
			? new Date(timing.startTime + timing.responseEnd)
			: new Date(timing.startTime);

	// Parse URL for attributes
	const parsedUrl = new URL(url);
	const serverAddress = parsedUrl.hostname;
	const serverPort =
		parsedUrl.port !== ""
			? Number.parseInt(parsedUrl.port, 10)
			: parsedUrl.protocol === "https:"
				? 443
				: 80;

	// Determine span status based on response
	// For HTTP client spans: 4xx and 5xx should be ERROR
	let statusCodeValue = SPAN_STATUS_CODE_UNSET;
	if (statusCode >= 400) {
		statusCodeValue = SPAN_STATUS_CODE_ERROR;
	}

	// Build attributes following OpenTelemetry HTTP semantic conventions
	const attributes: Record<string, string | number | boolean> = {
		"http.request.method": method,
		"url.full": url,
		"server.address": serverAddress,
		"server.port": serverPort,
		"http.response.status_code": statusCode,
	};

	// For error responses, set error.type to the status code
	if (statusCodeValue === SPAN_STATUS_CODE_ERROR) {
		attributes["error.type"] = statusCode.toString();
	}

	// Create the network span
	const networkSpan: NetworkSpan = {
		traceId,
		spanId,
		parentSpanId,
		name: `HTTP ${method}`,
		kind: SPAN_KIND_CLIENT,
		startTime,
		endTime,
		status: { code: statusCodeValue },
		attributes,
	};

	// Write span to file for reporter to collect
	writeNetworkSpan(outputDir, testId, traceHeader, networkSpan);
}
