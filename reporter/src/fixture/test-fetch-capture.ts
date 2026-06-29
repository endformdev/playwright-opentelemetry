import { generateSpanId } from "../shared/otel";
import type { FixtureSpan, TestTraceContext } from "./trace-context";

const SPAN_KIND_CLIENT = 3;
const SPAN_STATUS_CODE_UNSET = 0;
const SPAN_STATUS_CODE_ERROR = 2;

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

let originalFetch: typeof fetch | undefined;
let activeTraceContext: TestTraceContext | undefined;

export function runWithTestFetchCapture<T>(
	traceContext: TestTraceContext,
	callback: () => Promise<T>,
): Promise<T> {
	ensureFetchPatched();
	const previousTraceContext = activeTraceContext;
	activeTraceContext = traceContext;
	return (async () => {
		try {
			return await callback();
		} finally {
			activeTraceContext = previousTraceContext;
		}
	})();
}

export function resetTestFetchCaptureForTest(): void {
	if (globalThis.fetch === patchedFetch && originalFetch) {
		globalThis.fetch = originalFetch;
	}
	originalFetch = undefined;
	activeTraceContext = undefined;
}

function ensureFetchPatched(): void {
	if (globalThis.fetch === patchedFetch) {
		return;
	}

	originalFetch = globalThis.fetch.bind(globalThis) as typeof fetch;
	globalThis.fetch = patchedFetch;
}

const patchedFetch: typeof fetch = async (input, init) => {
	const traceContext = activeTraceContext;
	if (!traceContext) {
		return originalFetch ? originalFetch(input, init) : globalThis.fetch(input, init);
	}

	if (!originalFetch) {
		return globalThis.fetch(input, init);
	}

	const startTime = new Date();
	try {
		const response = await originalFetch(input, init);
		traceContext.addSpan(
			createFetchSpan({
				input,
				init,
				traceContext,
				startTime,
				endTime: new Date(),
				statusCode: response.status,
			}),
		);
		return response;
	} catch (error) {
		traceContext.addSpan(
			createFetchSpan({
				input,
				init,
				traceContext,
				startTime,
				endTime: new Date(),
				error,
			}),
		);
		throw error;
	}
};

function createFetchSpan({
	input,
	init,
	traceContext,
	startTime,
	endTime,
	statusCode,
	error,
}: {
	input: FetchInput;
	init: FetchInit;
	traceContext: TestTraceContext;
	startTime: Date;
	endTime: Date;
	statusCode?: number;
	error?: unknown;
}): FixtureSpan {
	const method = getFetchMethod(input, init);
	const url = getFetchUrl(input);
	const attributes = createHttpAttributes({ method, url, statusCode, error });
	const failed = error !== undefined || (statusCode !== undefined && statusCode >= 400);

	return {
		traceId: traceContext.traceId,
		spanId: generateSpanId(),
		parentSpanId: traceContext.rootSpanId,
		name: `HTTP ${method}`,
		kind: SPAN_KIND_CLIENT,
		startTime,
		endTime,
		status: failed
			? { code: SPAN_STATUS_CODE_ERROR, message: errorMessage(error) }
			: { code: SPAN_STATUS_CODE_UNSET },
		attributes,
		events: [],
	};
}

function createHttpAttributes({
	method,
	url,
	statusCode,
	error,
}: {
	method: string;
	url: string;
	statusCode?: number;
	error?: unknown;
}): FixtureSpan["attributes"] {
	const attributes: FixtureSpan["attributes"] = {
		"http.request.method": method,
		"http.resource.type": "fetch",
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
		// Relative or non-standard fetch URLs still keep url.full.
	}

	if (statusCode !== undefined) {
		attributes["http.response.status_code"] = statusCode;
		if (statusCode >= 400) {
			attributes["error.type"] = statusCode.toString();
		}
	} else if (error !== undefined) {
		attributes["error.type"] = errorType(error);
	}

	return attributes;
}

function getFetchMethod(input: FetchInput, init?: FetchInit): string {
	const method = init?.method ?? (input instanceof Request ? input.method : "GET");
	return method.toUpperCase();
}

function getFetchUrl(input: FetchInput): string {
	if (input instanceof Request) {
		return input.url;
	}
	return input.toString();
}

function serverPort(url: URL): number {
	if (url.port) {
		return Number.parseInt(url.port, 10);
	}
	return url.protocol === "https:" ? 443 : 80;
}

function errorType(error: unknown): string {
	if (error instanceof Error && error.name) {
		return error.name;
	}
	return "Error";
}

function errorMessage(error: unknown): string | undefined {
	return error instanceof Error && error.message ? error.message : undefined;
}
