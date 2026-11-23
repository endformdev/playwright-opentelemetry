import type { SpanAttributeValue } from "./otel";

/**
 * Calls the test made on Playwright's `APIRequestContext`s (`request`,
 * `page.request`, `context.request`, `playwright.request.newContext()`). The
 * fixture records what Playwright's step for the call doesn't have, the
 * response, and hands it to the reporter, which adds it to that step's span.
 */
export const API_REQUESTS_ATTACHMENT_NAME =
	"playwright-opentelemetry-api-requests";

export interface CapturedApiRequest {
	/** Upper case. */
	method: string;
	/** The URL as the test passed it, so possibly relative to a `baseURL`. */
	url: string;
	/** The URL that answered, after any redirects. */
	responseUrl?: string;
	/** ISO string. */
	startTime: string;
	/** ISO string. Missing when the test ended before the call did. */
	endTime?: string;
	statusCode?: number;
	/** Only {@link RECORDED_RESPONSE_HEADERS}, keyed in lower case. */
	responseHeaders?: Record<string, string>;
	/**
	 * The span ID in the `traceparent` header the fixture sent with the call.
	 * The reporter gives it to the call's span, which makes the spans of the
	 * service that answered its children.
	 */
	spanId?: string;
	/** The name of the error the call threw. */
	errorType?: string;
	/**
	 * Where the test made the call, which is also the location of Playwright's
	 * step for it. The file is relative to Playwright's `rootDir`.
	 */
	location?: ApiRequestLocation;
}

export interface ApiRequestLocation {
	file: string;
	line: number;
	column: number;
}

export interface ApiRequestsHandoff {
	requests: CapturedApiRequest[];
}

export const RECORDED_RESPONSE_HEADERS = ["content-type", "cache-control"];

export function parseApiRequestsHandoff(body: string): CapturedApiRequest[] {
	const parsed = JSON.parse(body) as Partial<ApiRequestsHandoff> | null;
	if (!Array.isArray(parsed?.requests)) {
		throw new Error("expected {requests: [...]}");
	}
	return parsed.requests.filter(
		(request): request is CapturedApiRequest =>
			typeof request?.method === "string" &&
			typeof request.url === "string" &&
			typeof request.startTime === "string" &&
			!Number.isNaN(new Date(request.startTime).getTime()),
	);
}

/** HTTP client span attributes for a call on an `APIRequestContext`. */
export function apiRequestHttpAttributes({
	method,
	url,
	statusCode,
	responseHeaders,
	errorType,
}: {
	method: string;
	url: string;
	statusCode?: number;
	responseHeaders?: Record<string, string>;
	/** Used when there is no status code to report. */
	errorType?: string;
}): Record<string, SpanAttributeValue> {
	const attributes: Record<string, SpanAttributeValue> = {
		"http.request.method": method,
		"http.resource.type": "fetch",
		"playwright.request.api": true,
		"url.full": url,
	};

	try {
		const parsedUrl = new URL(url);
		attributes["url.path"] = parsedUrl.pathname;
		attributes["server.address"] = parsedUrl.hostname;
		attributes["server.port"] = serverPort(parsedUrl);
		if (parsedUrl.search) {
			attributes["url.query"] = parsedUrl.search.slice(1);
		}
	} catch {
		// Keep url.full for relative or non-standard request URLs.
	}

	if (statusCode !== undefined) {
		attributes["http.response.status_code"] = statusCode;
		if (statusCode >= 400) {
			attributes["error.type"] = statusCode.toString();
		}
	} else if (errorType !== undefined) {
		attributes["error.type"] = errorType;
	}

	const contentType = responseHeaders?.["content-type"];
	const cacheControl = responseHeaders?.["cache-control"];
	if (contentType) {
		attributes["http.response.header.content-type"] = [contentType];
	}
	if (cacheControl) {
		attributes["http.response.header.cache-control"] = [cacheControl];
	}

	return attributes;
}

function serverPort(url: URL): number {
	if (url.port) {
		return Number.parseInt(url.port, 10);
	}
	return url.protocol === "https:" ? 443 : 80;
}

/**
 * The file name the fixture gives its wrapper around `APIRequestContext`
 * methods. Playwright leaves frames of Node's own modules out of the stack it
 * takes a step's location from, so the step for a wrapped call points at the
 * test's line, not at the wrapper.
 */
export const API_REQUEST_WRAPPER_FILE =
	"node:playwright-opentelemetry/api-request";
