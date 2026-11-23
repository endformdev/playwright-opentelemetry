import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ATTR_CODE_COLUMN_NUMBER,
	ATTR_CODE_FILE_PATH,
	ATTR_CODE_LINE_NUMBER,
} from "../src/reporter/otel-attributes";
import {
	ATTR_TEST_PHASE,
	ATTR_TEST_STEP_TITLE,
	TEST_SPAN_NAME,
	TEST_STEP_SPAN_NAME,
} from "../src/reporter/reporter-attributes";
import {
	API_REQUESTS_ATTACHMENT_NAME,
	type CapturedApiRequest,
} from "../src/shared/api-requests";
import type { Span } from "../src/shared/otel";
import {
	DEFAULT_START_TIME,
	retainedTraceAttachment,
	runReporterTest,
	type StepDefinition,
} from "./reporter-harness";

vi.mock("../src/reporter/sender", () => ({
	sendSpans: vi.fn(),
}));

import { sendSpans } from "../src/reporter/sender";

const TEST_FILE = "/Users/test/project/test-e2e/api.spec.ts";
const BASE = "http://127.0.0.1:3000";

describe("PlaywrightOpentelemetryReporter - API requests", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("turns a request step into the HTTP span for its request", async () => {
		const spans = await reportedSpans({
			steps: [
				{
					title: "Seed cart",
					category: "test.step",
					startTime: at(0),
					duration: 50,
					location: { file: TEST_FILE, line: 5, column: 3 },
					steps: [
						requestStep("GET", `${BASE}/api/cart`, { start: 1, line: 6 }),
						requestStep("POST", `${BASE}/api/cart`, { start: 11, line: 7 }),
					],
				},
			],
			requests: [
				request("GET", `${BASE}/api/cart`, {
					start: 2,
					status: 200,
					responseHeaders: { "content-type": "application/json" },
				}),
				request("POST", `${BASE}/api/cart`, { start: 12, status: 201 }),
			],
		});

		const seed = stepSpan(spans, "Seed cart");
		const get = httpSpan(spans, "GET");
		const post = httpSpan(spans, "POST");
		expect(spans.filter((span) => span.name === TEST_STEP_SPAN_NAME)).toEqual([
			seed,
		]);
		expect(get).toEqual(
			expect.objectContaining({
				parentSpanId: seed.spanId,
				kind: 3,
				startTime: at(1),
				endTime: at(9),
				status: { code: 0 },
			}),
		);
		expect(get.attributes).toEqual({
			"http.request.method": "GET",
			"http.resource.type": "fetch",
			"playwright.request.api": true,
			"url.full": `${BASE}/api/cart`,
			"url.path": "/api/cart",
			"server.address": "127.0.0.1",
			"server.port": 3000,
			"http.response.status_code": 200,
			"http.response.header.content-type": ["application/json"],
			[ATTR_CODE_FILE_PATH]: "api.spec.ts",
			[ATTR_CODE_LINE_NUMBER]: 6,
			[ATTR_CODE_COLUMN_NUMBER]: 5,
		});
		expect(post.parentSpanId).toBe(seed.spanId);
		expect(post.attributes).toEqual(
			expect.objectContaining({
				"http.response.status_code": 201,
				[ATTR_CODE_LINE_NUMBER]: 7,
			}),
		);
	});

	it("matches the title of steps from Playwright before 1.63", async () => {
		const spans = await reportedSpans({
			steps: [
				{
					title: 'GET "/api/me"',
					category: "pw:api",
					startTime: at(0),
					duration: 8,
					location: { file: TEST_FILE, line: 9 },
				},
			],
			requests: [request("GET", `${BASE}/api/me`, { start: 1, status: 200 })],
		});

		expect(httpSpan(spans, "GET").attributes).toEqual(
			expect.objectContaining({
				"url.full": `${BASE}/api/me`,
				[ATTR_CODE_LINE_NUMBER]: 9,
			}),
		);
		expect(spans.some((span) => span.name === TEST_STEP_SPAN_NAME)).toBe(false);
	});

	it("matches URLs relative to baseURL, with params applied", async () => {
		const spans = await reportedSpans({
			steps: [requestStep("GET", "users/1", { start: 0, line: 4 })],
			requests: [
				request("GET", `${BASE}/v2/users/1?expand=roles`, {
					start: 1,
					status: 200,
				}),
			],
		});

		expect(httpSpan(spans, "GET").attributes).toEqual(
			expect.objectContaining({
				"url.full": `${BASE}/v2/users/1?expand=roles`,
				"url.query": "expand=roles",
			}),
		);
	});

	it("keeps steps of requests the fixture did not record", async () => {
		// Sent at the same time, e.g. with Promise.all: only the URL tells
		// which step made the recorded request.
		const spans = await reportedSpans({
			steps: [
				requestStep("GET", `${BASE}/api/page-request`, { start: 0, line: 4 }),
				requestStep("GET", `${BASE}/api/cart`, { start: 1, line: 5 }),
			],
			requests: [request("GET", `${BASE}/api/cart`, { start: 2, status: 200 })],
		});

		const step = spans.find(
			(span) => span.attributes[ATTR_TEST_STEP_TITLE] === "GET",
		);
		expect(step?.name).toBe(TEST_STEP_SPAN_NAME);
		expect(step?.attributes[ATTR_CODE_LINE_NUMBER]).toBe(4);
		expect(httpSpan(spans, "GET").attributes[ATTR_CODE_LINE_NUMBER]).toBe(5);
	});

	it("does not match a request sent outside the step", async () => {
		const spans = await reportedSpans({
			steps: [requestStep("GET", `${BASE}/api/cart`, { start: 0, line: 4 })],
			requests: [
				request("GET", `${BASE}/api/cart`, { start: 40, status: 200 }),
			],
		});

		const [unmatched] = spans.filter((span) => span.name === "HTTP GET");
		expect(unmatched.parentSpanId).toBe(testSpan(spans).spanId);
		expect(unmatched.startTime).toEqual(at(40));
		expect(unmatched.attributes).not.toHaveProperty(ATTR_CODE_LINE_NUMBER);
		expect(
			spans.some(
				(span) =>
					span.name === TEST_STEP_SPAN_NAME &&
					span.attributes[ATTR_TEST_STEP_TITLE] === "GET",
			),
		).toBe(true);
	});

	it("pairs requests to the same URL with their steps in order", async () => {
		const spans = await reportedSpans({
			steps: [
				requestStep("GET", `${BASE}/api/status`, { start: 0, line: 4 }),
				requestStep("GET", `${BASE}/api/status`, { start: 10, line: 4 }),
			],
			requests: [
				request("GET", `${BASE}/api/status`, { start: 11, status: 503 }),
				request("GET", `${BASE}/api/status`, { start: 1, status: 200 }),
			],
		});

		const statuses = spans
			.filter((span) => span.name === "HTTP GET")
			.map((span) => span.attributes["http.response.status_code"]);
		expect(statuses).toEqual([200, 503]);
	});

	it("reports the final response of a followed redirect", async () => {
		const spans = await reportedSpans({
			steps: [requestStep("GET", `${BASE}/old`, { start: 0, line: 4 })],
			requests: [
				request("GET", `${BASE}/old`, {
					start: 1,
					status: 302,
					redirectUrl: "/new",
				}),
				request("GET", `${BASE}/new`, {
					start: 3,
					status: 200,
					responseHeaders: { "content-type": "text/plain" },
				}),
			],
		});

		const httpSpans = spans.filter((span) => span.name === "HTTP GET");
		expect(httpSpans).toHaveLength(1);
		expect(httpSpans[0].attributes).toEqual(
			expect.objectContaining({
				"url.full": `${BASE}/old`,
				"http.response.status_code": 200,
				"http.response.header.content-type": ["text/plain"],
			}),
		);
	});

	it("marks error responses and failed requests as errors", async () => {
		const spans = await reportedSpans({
			steps: [
				{
					...requestStep("GET", `${BASE}/missing`, { start: 0, line: 4 }),
					error: { message: "apiRequestContext.get: 404 Not Found" },
				},
				{
					...requestStep("GET", "http://127.0.0.1:1/refused", {
						start: 20,
						line: 5,
					}),
					error: { message: "apiRequestContext.get: connect ECONNREFUSED" },
				},
			],
			requests: [
				request("GET", `${BASE}/missing`, { start: 1, status: 404 }),
				request("GET", "http://127.0.0.1:1/refused", { start: 21, status: -1 }),
			],
		});

		const [missing, refused] = spans.filter((span) => span.name === "HTTP GET");
		expect(missing.status).toEqual({
			code: 2,
			message: "apiRequestContext.get: 404 Not Found",
		});
		expect(missing.attributes).toEqual(
			expect.objectContaining({
				"http.response.status_code": 404,
				"error.type": "404",
			}),
		);
		expect(refused.status).toEqual({
			code: 2,
			message: "apiRequestContext.get: connect ECONNREFUSED",
		});
		expect(refused.attributes).not.toHaveProperty("http.response.status_code");
		expect(refused.attributes["error.type"]).toBe("Error");
	});

	it("records the phase of requests made in hooks", async () => {
		const spans = await reportedSpans({
			steps: [
				{
					title: "Before Hooks",
					category: "hook",
					startTime: at(0),
					duration: 30,
					steps: [
						requestStep("POST", `${BASE}/api/login`, { start: 1, line: 3 }),
					],
				},
			],
			requests: [
				request("POST", `${BASE}/api/login`, { start: 2, status: 200 }),
			],
		});

		expect(httpSpan(spans, "POST").attributes[ATTR_TEST_PHASE]).toBe("before");
	});

	it("ignores an invalid requests attachment", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const spans = await reportedSpans({
			steps: [requestStep("GET", `${BASE}/api/cart`, { start: 0, line: 4 })],
			requestsBody: "not json",
		});

		expect(spans.some((span) => span.name === "HTTP GET")).toBe(false);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(
				`Ignoring invalid ${API_REQUESTS_ATTACHMENT_NAME}`,
			),
		);
		warn.mockRestore();
	});
});

function at(offsetMs: number): Date {
	return new Date(DEFAULT_START_TIME.getTime() + offsetMs);
}

function requestStep(
	method: string,
	url: string,
	{ start, line }: { start: number; line: number },
): StepDefinition {
	return {
		title: method,
		category: "pw:api",
		params: { url, method },
		startTime: at(start),
		duration: 8,
		location: { file: TEST_FILE, line, column: 5 },
	};
}

function request(
	method: string,
	url: string,
	options: {
		start: number;
		status: number;
		redirectUrl?: string;
		responseHeaders?: Record<string, string>;
	},
): CapturedApiRequest {
	return {
		method,
		url,
		startTime: at(options.start).toISOString(),
		status: options.status,
		...(options.redirectUrl && { redirectUrl: options.redirectUrl }),
		responseHeaders: options.responseHeaders ?? {},
	};
}

async function reportedSpans({
	steps,
	requests,
	requestsBody,
}: {
	steps: StepDefinition[];
	requests?: CapturedApiRequest[];
	requestsBody?: string;
}): Promise<Span[]> {
	await runReporterTest({
		config: { rootDir: "/Users/test/project/test-e2e" },
		test: { title: "api requests" },
		result: {
			steps,
			attachments: [
				retainedTraceAttachment(),
				{
					name: API_REQUESTS_ATTACHMENT_NAME,
					contentType: "application/json",
					body: Buffer.from(requestsBody ?? JSON.stringify({ requests })),
				},
			],
		},
	});
	const [spans] = (sendSpans as ReturnType<typeof vi.fn>).mock.calls[0];
	return spans as Span[];
}

function testSpan(spans: Span[]): Span {
	const span = spans.find((span) => span.name === TEST_SPAN_NAME);
	if (!span) throw new Error("no test span");
	return span;
}

function stepSpan(spans: Span[], title: string): Span {
	const span = spans.find(
		(span) =>
			span.name === TEST_STEP_SPAN_NAME &&
			span.attributes[ATTR_TEST_STEP_TITLE] === title,
	);
	if (!span) throw new Error(`no step span ${title}`);
	return span;
}

function httpSpan(spans: Span[], method: string): Span {
	const span = spans.find((span) => span.name === `HTTP ${method}`);
	if (!span) throw new Error(`no HTTP ${method} span`);
	return span;
}
