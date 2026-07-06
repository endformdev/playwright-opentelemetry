import type { APIRequestContext, APIResponse } from "@playwright/test";
import { generateSpanId } from "../shared/otel";
import type { FixtureSpan, TestTraceContext } from "./trace-context";

const SPAN_KIND_CLIENT = 3;
const SPAN_STATUS_CODE_UNSET = 0;
const SPAN_STATUS_CODE_ERROR = 2;

const CAPTURED_METHODS = new Set([
	"delete",
	"fetch",
	"get",
	"head",
	"patch",
	"post",
	"put",
]);

export function createCapturedApiRequestContext(
	request: APIRequestContext,
	traceContext: TestTraceContext,
): APIRequestContext {
	return new Proxy(request, {
		get(target, property, receiver) {
			const value = Reflect.get(target, property, receiver) as unknown;
			if (typeof property !== "string" || !CAPTURED_METHODS.has(property)) {
				return value;
			}

			if (typeof value !== "function") {
				return value;
			}

			return async (...args: unknown[]) => {
				const startTime = new Date();
				try {
					const response = (await value.apply(target, args)) as APIResponse;
					traceContext.addSpan(
						createApiRequestSpan({
							methodName: property,
							args,
							traceContext,
							startTime,
							endTime: new Date(),
							statusCode: response.status(),
						}),
					);
					return response;
				} catch (error) {
					traceContext.addSpan(
						createApiRequestSpan({
							methodName: property,
							args,
							traceContext,
							startTime,
							endTime: new Date(),
							error,
						}),
					);
					throw error;
				}
			};
		},
	});
}

function createApiRequestSpan({
	methodName,
	args,
	traceContext,
	startTime,
	endTime,
	statusCode,
	error,
}: {
	methodName: string;
	args: unknown[];
	traceContext: TestTraceContext;
	startTime: Date;
	endTime: Date;
	statusCode?: number;
	error?: unknown;
}): FixtureSpan {
	const method = getRequestMethod(methodName, args);
	const url = getRequestUrl(args[0]);
	const attributes = createHttpAttributes({ method, url, statusCode, error });
	const failed =
		error !== undefined || (statusCode !== undefined && statusCode >= 400);

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
	} else if (error !== undefined) {
		attributes["error.type"] = errorType(error);
	}

	return attributes;
}

function getRequestMethod(methodName: string, args: unknown[]): string {
	const options = getOptions(args[1]);
	if (methodName === "fetch") {
		const input = args[0];
		const method =
			options.method ??
			(input instanceof Request ? input.method : undefined) ??
			"GET";
		return method.toUpperCase();
	}

	return methodName.toUpperCase();
}

function getRequestUrl(input: unknown): string {
	if (input instanceof Request) {
		return input.url;
	}

	return String(input);
}

function getOptions(value: unknown): { method?: string } {
	if (typeof value !== "object" || value === null || !("method" in value)) {
		return {};
	}

	const method = (value as { method?: unknown }).method;
	return typeof method === "string" ? { method } : {};
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
