import type { SpanAttributeValue } from "./otel";

/**
 * Requests the test made through Playwright's `request` fixture, which the
 * fixture records in a HAR and hands to the reporter. The reporter turns the
 * matching `pw:api` steps into HTTP client spans.
 */
export const API_REQUESTS_ATTACHMENT_NAME =
	"playwright-opentelemetry-api-requests";

export interface CapturedApiRequest {
	method: string;
	/** The URL that was requested, with `params` applied. */
	url: string;
	/** When Playwright sent the request, as an ISO string. */
	startTime: string;
	/** -1 when no response arrived. */
	status: number;
	/** The response's `Location` header, for following redirects. */
	redirectUrl?: string;
	/** Only {@link RECORDED_RESPONSE_HEADERS}, keyed in lower case. */
	responseHeaders: Record<string, string>;
}

export interface ApiRequestsHandoff {
	requests: CapturedApiRequest[];
}

const RECORDED_RESPONSE_HEADERS = ["content-type", "cache-control"];

/**
 * The parts of a HAR the reporter needs. Leaves out request headers and
 * cookies, which can hold credentials.
 */
export function apiRequestsFromHar(har: unknown): CapturedApiRequest[] {
	const entries = (har as { log?: { entries?: unknown } } | undefined)?.log
		?.entries;
	if (!Array.isArray(entries)) {
		return [];
	}

	const requests: CapturedApiRequest[] = [];
	for (const entry of entries as HarEntry[]) {
		const method = entry?.request?.method;
		const url = entry?.request?.url;
		const startTime = entry?.startedDateTime;
		if (
			typeof method !== "string" ||
			typeof url !== "string" ||
			typeof startTime !== "string"
		) {
			continue;
		}

		const responseHeaders: Record<string, string> = {};
		for (const header of entry.response?.headers ?? []) {
			const name = header?.name?.toLowerCase();
			if (
				name &&
				RECORDED_RESPONSE_HEADERS.includes(name) &&
				typeof header.value === "string" &&
				!(name in responseHeaders)
			) {
				responseHeaders[name] = header.value;
			}
		}

		const status = entry.response?.status;
		const redirectUrl = entry.response?.redirectURL;
		requests.push({
			method,
			url,
			startTime,
			status: typeof status === "number" ? status : -1,
			...(typeof redirectUrl === "string" && redirectUrl && { redirectUrl }),
			responseHeaders,
		});
	}
	return requests;
}

type HarEntry = {
	startedDateTime?: unknown;
	request?: { method?: unknown; url?: unknown };
	response?: {
		status?: unknown;
		redirectURL?: unknown;
		headers?: Array<{ name?: string; value?: unknown }>;
	};
};

export function parseApiRequestsHandoff(body: string): CapturedApiRequest[] {
	const parsed = JSON.parse(body) as Partial<ApiRequestsHandoff>;
	if (!Array.isArray(parsed.requests)) {
		throw new Error("expected {requests: [...]}");
	}
	return parsed.requests.filter(
		(request): request is CapturedApiRequest =>
			typeof request?.method === "string" &&
			typeof request.url === "string" &&
			typeof request.startTime === "string" &&
			typeof request.status === "number" &&
			typeof request.responseHeaders === "object" &&
			request.responseHeaders !== null,
	);
}

/** HTTP client span attributes for a request made through `request`. */
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
