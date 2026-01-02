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
 * Resource types for HTTP requests, similar to Chrome DevTools Network tab categories.
 * @see https://developer.chrome.com/docs/devtools/network/reference#type
 */
export type ResourceType =
	| "document"
	| "script"
	| "stylesheet"
	| "image"
	| "font"
	| "media"
	| "fetch"
	| "other";

/**
 * Detects the resource type based on Content-Type header with URL extension fallback.
 * This categorization mirrors Chrome DevTools Network tab behavior.
 *
 * @param contentType - The Content-Type response header value (may be null)
 * @param url - The request URL (used as fallback)
 * @returns The detected resource type
 */
export function detectResourceType(
	contentType: string | null,
	url: string,
): ResourceType {
	// First, try to determine from Content-Type header
	if (contentType) {
		const mimeType = contentType.split(";")[0].trim().toLowerCase();

		// Skip generic/uninformative content types - fall through to URL detection
		if (mimeType !== "application/octet-stream") {
			// Document types
			if (mimeType === "text/html" || mimeType === "application/xhtml+xml") {
				return "document";
			}

			// Script types
			if (
				mimeType === "application/javascript" ||
				mimeType === "text/javascript" ||
				mimeType === "application/x-javascript" ||
				mimeType === "application/ecmascript" ||
				mimeType === "text/ecmascript" ||
				mimeType === "module" ||
				mimeType === "application/wasm"
			) {
				return "script";
			}

			// Stylesheet types
			if (mimeType === "text/css") {
				return "stylesheet";
			}

			// Image types
			if (mimeType.startsWith("image/")) {
				return "image";
			}

			// Font types
			if (
				mimeType.startsWith("font/") ||
				mimeType === "application/font-woff" ||
				mimeType === "application/font-woff2" ||
				mimeType === "application/x-font-ttf" ||
				mimeType === "application/x-font-opentype"
			) {
				return "font";
			}

			// Media types (audio/video)
			if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) {
				return "media";
			}

			// Fetch/XHR types (API calls)
			if (
				mimeType === "application/json" ||
				mimeType === "text/plain" ||
				mimeType === "application/xml" ||
				mimeType === "text/xml" ||
				mimeType.endsWith("+json") ||
				mimeType.endsWith("+xml")
			) {
				return "fetch";
			}
		}
	}

	// Fallback: try to determine from URL extension
	const resourceType = detectResourceTypeFromUrl(url);
	if (resourceType) {
		return resourceType;
	}

	return "other";
}

/**
 * Detects resource type from URL file extension.
 * Used as fallback when Content-Type header is missing or generic.
 */
function detectResourceTypeFromUrl(url: string): ResourceType | null {
	try {
		const parsedUrl = new URL(url);
		const pathname = parsedUrl.pathname.toLowerCase();

		// Extract extension (handle query strings and fragments)
		const lastSegment = pathname.split("/").pop() || "";
		const dotIndex = lastSegment.lastIndexOf(".");
		if (dotIndex === -1) {
			return null;
		}
		const extension = lastSegment.slice(dotIndex + 1);

		// Document extensions
		if (extension === "html" || extension === "htm" || extension === "xhtml") {
			return "document";
		}

		// Script extensions
		if (
			extension === "js" ||
			extension === "mjs" ||
			extension === "cjs" ||
			extension === "jsx" ||
			extension === "ts" ||
			extension === "tsx" ||
			extension === "wasm"
		) {
			return "script";
		}

		// Stylesheet extensions
		if (extension === "css") {
			return "stylesheet";
		}

		// Image extensions
		if (
			extension === "png" ||
			extension === "jpg" ||
			extension === "jpeg" ||
			extension === "gif" ||
			extension === "svg" ||
			extension === "webp" ||
			extension === "ico" ||
			extension === "bmp" ||
			extension === "avif"
		) {
			return "image";
		}

		// Font extensions
		if (
			extension === "woff" ||
			extension === "woff2" ||
			extension === "ttf" ||
			extension === "otf" ||
			extension === "eot"
		) {
			return "font";
		}

		// Media extensions
		if (
			extension === "mp4" ||
			extension === "webm" ||
			extension === "ogg" ||
			extension === "mp3" ||
			extension === "wav" ||
			extension === "m4a" ||
			extension === "aac" ||
			extension === "flac" ||
			extension === "avi" ||
			extension === "mov"
		) {
			return "media";
		}

		// Fetch/API extensions
		if (extension === "json" || extension === "xml") {
			return "fetch";
		}

		return null;
	} catch {
		return null;
	}
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

	// Get Content-Type header for resource type detection
	const contentType = await response.headerValue("content-type");

	// Detect resource type from Content-Type with URL extension fallback
	const resourceType = detectResourceType(contentType, url);

	// Build attributes following OpenTelemetry HTTP semantic conventions
	const attributes: Record<string, string | number | boolean> = {
		"http.request.method": method,
		"url.full": url,
		"url.path": parsedUrl.pathname,
		"server.address": serverAddress,
		"server.port": serverPort,
		"http.response.status_code": statusCode,
		"http.resource.type": resourceType,
	};

	// Add query string if present (without the leading '?')
	if (parsedUrl.search) {
		attributes["url.query"] = parsedUrl.search.slice(1);
	}

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
		serviceName: "playwright-browser",
	};

	// Write span to file for reporter to collect
	writeNetworkSpan(outputDir, testId, traceHeader, networkSpan);
}
