import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import type {
	APIRequest,
	APIRequestContext,
	APIResponse,
	TestInfo,
} from "@playwright/test";
import {
	API_REQUEST_WRAPPER_FILE,
	API_REQUESTS_ATTACHMENT_NAME,
	type ApiRequestLocation,
	type ApiRequestsHandoff,
	type CapturedApiRequest,
	RECORDED_RESPONSE_HEADERS,
} from "../shared/api-requests";
import type { ResolvedPlaywrightOpentelemetryConfig } from "../shared/config";
import { filterRetainedDestinations } from "../shared/destinations";
import {
	API_REQUESTS_HANDOFF_FILE,
	type FixtureHandoffTestInfo,
	writeFixtureHandoffFile,
} from "../shared/fixture-handoff";
import { generateSpanId, traceparentHeader } from "../shared/otel";
import {
	type PlaywrightTraceOption,
	shouldRetainPlaywrightTrace,
} from "../shared/playwright-trace";

const CAPTURED_METHODS = [
	"delete",
	"fetch",
	"get",
	"head",
	"patch",
	"post",
	"put",
] as const;

type RecordingOptions = {
	/** Playwright's `rootDir`; recorded locations are relative to it. */
	rootDir: string;
	/** Set to send a `traceparent` header of this trace with each call. */
	traceId?: string;
};

type Recording = RecordingOptions & {
	requests: CapturedApiRequest[];
};

type CaptureState = {
	/** The test whose calls are being recorded. A worker runs one at a time. */
	recording?: Recording;
	/** `get()` calls `fetch()`: only the call the test made is recorded. */
	depth: number;
};

// On globalThis so the ESM and CommonJS builds of this module share one
// state: the wrappers are installed once per process, whichever build did it.
const STATE_KEY = Symbol.for("playwright-opentelemetry.api-request-capture");
const WRAPPED = Symbol.for("playwright-opentelemetry.api-request-wrapper");
const state = ((globalThis as { [STATE_KEY]?: CaptureState })[STATE_KEY] ??= {
	depth: 0,
});

type AnyFunction = Function;

/**
 * Wraps a Playwright method without changing where Playwright says the call
 * came from. A step's location is the first stack frame outside Playwright,
 * so a wrapper written in this file would become the location of every step
 * it wraps. Playwright skips the frames of Node's own modules, and this
 * wrapper is compiled with such a file name. `begin` and `end` are not on the
 * stack while `original` runs.
 */
const createWrapper = vm.compileFunction(
	`return function (...args) {
	const call = begin(args);
	let result;
	try {
		result = Reflect.apply(original, this, args);
	} catch (error) {
		end(call, undefined);
		throw error;
	}
	return end(call, result);
};`,
	["original", "begin", "end"],
	{ filename: API_REQUEST_WRAPPER_FILE },
) as <Call>(
	original: AnyFunction,
	begin: (args: unknown[]) => Call,
	end: (call: Call, result: unknown) => unknown,
) => AnyFunction;

/**
 * Records the calls made on every `APIRequestContext` of this process, by
 * wrapping the methods of the class they share. The test still gets
 * Playwright's own objects. Does nothing while no recording is active.
 */
export function captureApiRequests(requestContext: APIRequestContext): void {
	try {
		wrapRequestMethods(requestContext);
	} catch {
		// Requests stay unrecorded; the test must not notice.
	}
}

function wrapRequestMethods(requestContext: APIRequestContext): void {
	const prototype = Object.getPrototypeOf(requestContext) as Record<
		string,
		unknown
	> | null;
	if (!prototype || prototype === Object.prototype) {
		return;
	}

	for (const methodName of CAPTURED_METHODS) {
		const original = prototype[methodName];
		if (typeof original !== "function" || isWrapped(original)) {
			continue;
		}
		prototype[methodName] = markWrapped(
			createWrapper(original, (args) => beginCall(methodName, args), endCall),
		);
	}
}

/**
 * The class of `APIRequestContext` can only be reached through an instance:
 * finds it when `playwright.request.newContext()` creates the first one, which
 * is also how Playwright creates the `request` fixture.
 */
export function captureNewApiRequestContexts(apiRequest: APIRequest): void {
	const target = apiRequest as unknown as Record<string, unknown>;
	const original = target.newContext;
	if (typeof original !== "function" || isWrapped(original)) {
		return;
	}
	target.newContext = markWrapped(
		createWrapper(
			original,
			() => undefined,
			(_call, result) => {
				if (!isPromiseLike(result)) {
					return result;
				}
				// Before the test continues, so its first call is recorded.
				return result.then((requestContext) => {
					captureApiRequests(requestContext as APIRequestContext);
					return requestContext;
				});
			},
		),
	);
}

export type ApiRequestRecording = {
	/** Stops recording and returns the calls made, in the order they began. */
	stop(): CapturedApiRequest[];
};

export function startApiRequestRecording(
	options: RecordingOptions,
): ApiRequestRecording {
	const recording: Recording = { ...options, requests: [] };
	const previous = state.recording;
	state.recording = recording;
	return {
		stop() {
			if (state.recording === recording) {
				state.recording = previous;
			}
			return recording.requests;
		},
	};
}

export function resetApiRequestCaptureForTest(): void {
	state.recording = undefined;
	state.depth = 0;
}

function beginCall(
	methodName: string,
	args: unknown[],
): CapturedApiRequest | undefined {
	state.depth++;
	const recording = state.recording;
	if (state.depth > 1 || !recording) {
		return undefined;
	}

	try {
		const call: CapturedApiRequest = {
			method: requestMethod(methodName, args),
			url: requestUrl(args[0]),
			startTime: new Date().toISOString(),
			location: callSite(recording.rootDir),
		};
		if (recording.traceId) {
			const spanId = generateSpanId();
			if (addTraceparent(args, traceparentHeader(recording.traceId, spanId))) {
				call.spanId = spanId;
			}
		}
		recording.requests.push(call);
		return call;
	} catch {
		return undefined;
	}
}

function endCall(
	call: CapturedApiRequest | undefined,
	result: unknown,
): unknown {
	state.depth--;
	// Unrecorded calls hand back Playwright's own promise untouched.
	if (!call || !isPromiseLike(result)) {
		return result;
	}

	return result.then(
		(response) => {
			recordResponse(call, response as APIResponse);
			return response;
		},
		(error: unknown) => {
			call.endTime = new Date().toISOString();
			call.errorType =
				error instanceof Error && error.name ? error.name : "Error";
			throw error;
		},
	);
}

function recordResponse(call: CapturedApiRequest, response: APIResponse): void {
	call.endTime = new Date().toISOString();
	try {
		call.statusCode = response.status();
		call.responseUrl = response.url();
		const headers = response.headers();
		const recorded: Record<string, string> = {};
		for (const name of RECORDED_RESPONSE_HEADERS) {
			if (typeof headers[name] === "string") {
				recorded[name] = headers[name];
			}
		}
		call.responseHeaders = recorded;
	} catch {
		// Keep what was read.
	}
}

/**
 * Adds the header to the call's options, which `args` holds and Playwright is
 * about to be called with. Leaves a `traceparent` the test set itself alone.
 */
function addTraceparent(args: unknown[], traceparent: string): boolean {
	const options = args[1] as { headers?: unknown } | undefined | null;
	if (options !== undefined && (typeof options !== "object" || !options)) {
		return false;
	}

	// Without headers of its own, `fetch()` sends those of its `Request`.
	const headers =
		options?.headers ??
		(typeof args[0] === "string" ? {} : requestHeaders(args[0]));
	if (
		typeof headers !== "object" ||
		headers === null ||
		Object.keys(headers).some((name) => name.toLowerCase() === "traceparent")
	) {
		return false;
	}

	args[1] = { ...options, headers: { ...headers, traceparent } };
	return true;
}

function requestHeaders(input: unknown): unknown {
	const headers = (input as { headers?: unknown } | null | undefined)?.headers;
	return typeof headers === "function" ? headers.call(input) : undefined;
}

function requestMethod(methodName: string, args: unknown[]): string {
	if (methodName !== "fetch") {
		return methodName.toUpperCase();
	}

	const options = args[1] as { method?: unknown } | undefined;
	const method =
		typeof options?.method === "string"
			? options.method
			: (callIfFunction(args[0], "method") ?? "GET");
	return method.toUpperCase();
}

/** `fetch()` also takes a Playwright `Request`. */
function requestUrl(input: unknown): string {
	return typeof input === "string"
		? input
		: (callIfFunction(input, "url") ?? String(input));
}

function callIfFunction(target: unknown, name: string): string | undefined {
	const member = (target as Record<string, unknown> | null | undefined)?.[name];
	if (typeof member !== "function") {
		return undefined;
	}
	const value: unknown = member.call(target);
	return typeof value === "string" ? value : undefined;
}

const STACK_FRAME_LOCATION = /^\s*at (?:.*? \()?(.+?):(\d+):(\d+)\)?$/;
const PLAYWRIGHT_PACKAGE_FILE =
	/[/\\]node_modules[/\\](?:playwright|playwright-core|@playwright[/\\]test)[/\\]/;

/**
 * Where the wrapped method was called from: the first frame below the wrapper
 * that Playwright would also take as the step's location.
 */
function callSite(rootDir: string): ApiRequestLocation | undefined {
	const stackTraceLimit = Error.stackTraceLimit;
	Error.stackTraceLimit = Math.max(stackTraceLimit, 20);
	const stack = new Error().stack?.split("\n") ?? [];
	Error.stackTraceLimit = stackTraceLimit;

	const wrapperIndex = stack.findIndex((line) =>
		line.includes(API_REQUEST_WRAPPER_FILE),
	);
	if (wrapperIndex === -1) {
		return undefined;
	}

	for (const line of stack.slice(wrapperIndex + 1)) {
		const match = STACK_FRAME_LOCATION.exec(line);
		if (!match) {
			continue;
		}
		const file = match[1].startsWith("file://")
			? fileURLToPath(match[1])
			: match[1];
		if (!path.isAbsolute(file) || PLAYWRIGHT_PACKAGE_FILE.test(file)) {
			continue;
		}
		return {
			file: path.relative(rootDir, file),
			line: Number(match[2]),
			column: Number(match[3]),
		};
	}
	return undefined;
}

type HandOffApiRequestsOptions = {
	trace: PlaywrightTraceOption | undefined;
	testInfo: FixtureHandoffTestInfo &
		Pick<TestInfo, "attach" | "expectedStatus" | "status">;
};

/**
 * Hands the recorded calls to the reporter, if anything keeps this test.
 * Never rejects: a test must not fail because its requests couldn't be
 * stored.
 */
export async function handOffApiRequests(
	requests: CapturedApiRequest[],
	config: ResolvedPlaywrightOpentelemetryConfig,
	options: HandOffApiRequestsOptions,
): Promise<void> {
	try {
		const retainsTrace = (trace: PlaywrightTraceOption | null) =>
			shouldRetainPlaywrightTrace(trace ?? options.trace, options.testInfo);
		const retained =
			(config.storeTraceZip && retainsTrace(config.trace)) ||
			[config.otlpDestinations, config.playwrightTraceApiDestinations].some(
				(destinations) =>
					filterRetainedDestinations(destinations, config.trace, retainsTrace)
						.length > 0,
			);
		if (requests.length === 0 || !retained) {
			return;
		}

		const handoff: ApiRequestsHandoff = { requests };
		const body = JSON.stringify(handoff);
		if (config.attachFixtureData) {
			await options.testInfo.attach(API_REQUESTS_ATTACHMENT_NAME, {
				body,
				contentType: "application/json",
			});
			return;
		}
		await writeFixtureHandoffFile(
			options.testInfo,
			API_REQUESTS_HANDOFF_FILE,
			body,
		);
	} catch (error) {
		console.warn(
			`Failed to store API requests: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

function isWrapped(method: AnyFunction): boolean {
	return (method as { [WRAPPED]?: boolean })[WRAPPED] === true;
}

function markWrapped(wrapper: AnyFunction): AnyFunction {
	(wrapper as { [WRAPPED]?: boolean })[WRAPPED] = true;
	return wrapper;
}
