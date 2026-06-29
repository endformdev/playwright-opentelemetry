import type { Request, Response } from "@playwright/test";
import {
	BROWSER_SERVICE_NAME,
	type FixtureSpan,
	type TestTraceContext,
} from "./trace-context";

export interface FixtureCaptureOptions {
	request: Request;
	response: Response;
	traceContext: TestTraceContext;
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
 * Captures request/response data and stores the complete network span in the
 * current test trace context. Called after the request has completed.
 *
 * @param options - The capture options
 */
export async function fixtureCaptureRequestResponse({
	request,
	response,
	traceContext,
}: FixtureCaptureOptions): Promise<void> {
	const url = request.url();
	const method = request.method();
	const statusCode = response.status();
	const requestTraceContext = traceContext.requestContexts.get(request);

	if (!requestTraceContext) {
		return;
	}

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

	// Response events can outlive page teardown; resource detection can fall back to the URL.
	const contentType = await getResponseHeaderValue(response, "content-type");

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
		"browser.request.route_association": requestTraceContext.routeAssociation,
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
	const networkSpan: FixtureSpan = {
		traceId: requestTraceContext.traceId,
		spanId: requestTraceContext.spanId,
		parentSpanId: requestTraceContext.parentSpanId,
		name: `HTTP ${method}`,
		kind: SPAN_KIND_CLIENT,
		startTime,
		endTime,
		status: { code: statusCodeValue },
		attributes,
		events: [],
		serviceName: BROWSER_SERVICE_NAME,
	};

	traceContext.addSpan(networkSpan);
}

async function getResponseHeaderValue(
	response: Response,
	name: string,
): Promise<string | null> {
	try {
		return await response.headerValue(name);
	} catch {
		return null;
	}
}
