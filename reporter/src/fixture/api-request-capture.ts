import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
	APIRequestContext,
	APIResponse,
	TestInfo,
} from "@playwright/test";
import {
	API_REQUESTS_ATTACHMENT_NAME,
	apiRequestHttpAttributes,
	apiRequestsFromHar,
	type ApiRequestsHandoff,
} from "../shared/api-requests";
import {
	API_REQUESTS_HANDOFF_FILE,
	type FixtureHandoffTestInfo,
	writeFixtureHandoffFile,
} from "../shared/fixture-handoff";
import { generateSpanId } from "../shared/otel";
import type { FixtureSpan, TestTraceContext } from "./trace-context";

const SPAN_KIND_CLIENT = 3;
const SPAN_STATUS_CODE_UNSET = 0;
const SPAN_STATUS_CODE_ERROR = 2;

export type ApiRequestHar = {
	/**
	 * Stops recording and hands the requests to the reporter. Never rejects: a
	 * test must not fail because its requests couldn't be recorded.
	 */
	stop(): Promise<void>;
};

type HandOffOptions = {
	attachFixtureData: boolean;
	testInfo: FixtureHandoffTestInfo & Pick<TestInfo, "attach">;
};

/**
 * Records the context's requests in a HAR (`tracing.startHar`, Playwright
 * 1.60+). Unlike wrapping the context, this leaves Playwright's step for each
 * call pointing at the test's own line. Returns undefined when the HAR can't
 * be started, so the caller can fall back to
 * {@link createCapturedApiRequestContext}.
 */
export async function startApiRequestHar(
	request: APIRequestContext,
	options: HandOffOptions,
): Promise<ApiRequestHar | undefined> {
	const tracing = (request as Partial<APIRequestContext>).tracing as
		| HarTracing
		| undefined;
	if (
		typeof tracing?.startHar !== "function" ||
		typeof tracing.stopHar !== "function"
	) {
		return undefined;
	}

	let dir: string | undefined;
	try {
		dir = await fs.mkdtemp(
			path.join(os.tmpdir(), "playwright-opentelemetry-har-"),
		);
		const harPath = path.join(dir, "api-requests.har");
		// "minimal" leaves out cookies and timings; the reporter takes timings
		// from Playwright's steps.
		await tracing.startHar(harPath, { content: "omit", mode: "minimal" });
		const harDir = dir;
		return {
			async stop() {
				try {
					await tracing.stopHar();
					const har: unknown = JSON.parse(await fs.readFile(harPath, "utf-8"));
					await handOffApiRequests(
						{ requests: apiRequestsFromHar(har) },
						options,
					);
				} catch (error) {
					console.warn(`Failed to record API requests: ${errorMessage(error)}`);
				} finally {
					await fs.rm(harDir, { recursive: true, force: true });
				}
			},
		};
	} catch (error) {
		console.warn(
			`Failed to start recording API requests, falling back to wrapping the request fixture: ${errorMessage(error)}`,
		);
		if (dir) {
			await fs.rm(dir, { recursive: true, force: true });
		}
		return undefined;
	}
}

type HarTracing = {
	startHar(
		path: string,
		options: { content: "omit"; mode: "minimal" },
	): Promise<unknown>;
	stopHar(): Promise<void>;
};

async function handOffApiRequests(
	handoff: ApiRequestsHandoff,
	{ attachFixtureData, testInfo }: HandOffOptions,
): Promise<void> {
	if (handoff.requests.length === 0) {
		return;
	}

	const body = JSON.stringify(handoff);
	if (attachFixtureData) {
		await testInfo.attach(API_REQUESTS_ATTACHMENT_NAME, {
			body,
			contentType: "application/json",
		});
		return;
	}
	await writeFixtureHandoffFile(testInfo, API_REQUESTS_HANDOFF_FILE, body);
}

const CAPTURED_METHODS = new Set([
	"delete",
	"fetch",
	"get",
	"head",
	"patch",
	"post",
	"put",
]);

/**
 * For Playwright versions without `tracing.startHar`: wraps the context and
 * records each call as a span. Playwright then locates each call's step in
 * this file, so the reporter leaves those steps out.
 */
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
							responseHeaders: response.headers(),
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
	responseHeaders,
	error,
}: {
	methodName: string;
	args: unknown[];
	traceContext: TestTraceContext;
	startTime: Date;
	endTime: Date;
	statusCode?: number;
	responseHeaders?: Record<string, string>;
	error?: unknown;
}): FixtureSpan {
	const method = getRequestMethod(methodName, args);
	const url = getRequestUrl(args[0]);
	const attributes = apiRequestHttpAttributes({
		method,
		url,
		statusCode,
		responseHeaders,
		errorType: error === undefined ? undefined : errorType(error),
	});
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
			? { code: SPAN_STATUS_CODE_ERROR, message: errorMessageOf(error) }
			: { code: SPAN_STATUS_CODE_UNSET },
		attributes,
		events: [],
	};
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

function errorType(error: unknown): string {
	if (error instanceof Error && error.name) {
		return error.name;
	}
	return "Error";
}

function errorMessageOf(error: unknown): string | undefined {
	return error instanceof Error && error.message ? error.message : undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
