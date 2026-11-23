import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ATTR_CODE_COLUMN_NUMBER,
	ATTR_CODE_FILE_PATH,
	ATTR_CODE_LINE_NUMBER,
} from "../src/reporter/otel-attributes";
import {
	ATTR_TEST_STEP_TITLE,
	TEST_STEP_SPAN_NAME,
} from "../src/reporter/reporter-attributes";
import {
	API_REQUEST_WRAPPER_FILE,
	API_REQUESTS_ATTACHMENT_NAME,
	type CapturedApiRequest,
} from "../src/shared/api-requests";
import {
	API_REQUESTS_HANDOFF_FILE,
	fixtureHandoffDir,
	TRACE_CONTEXT_HANDOFF_FILE,
} from "../src/shared/fixture-handoff";
import { generateSpanId, generateTraceId, type Span } from "../src/shared/otel";
import {
	DEFAULT_ROOT_DIR,
	retainedTraceAttachment,
	runReporterTest,
	type StepDefinition,
	temporaryOutputDir,
} from "./reporter-harness";

vi.mock("../src/reporter/sender", () => ({
	sendSpans: vi.fn(),
}));

import { sendSpans } from "../src/reporter/sender";

const SPEC_FILE = "cart.spec.ts";

/** A request step as Playwright 1.63+ reports it. */
function requestStep(
	method: string,
	url: string,
	line: number,
	extra: Partial<StepDefinition> = {},
): StepDefinition {
	return {
		title: method,
		category: "pw:api",
		params: { url, method },
		location: { file: `${DEFAULT_ROOT_DIR}/${SPEC_FILE}`, line, column: 17 },
		...extra,
	};
}

function recorded(
	method: string,
	url: string,
	line: number,
	extra: Partial<CapturedApiRequest> = {},
): CapturedApiRequest {
	return {
		method,
		url,
		responseUrl: `https://shop.example.com${url}`,
		startTime: "2025-11-06T10:00:00.100Z",
		endTime: "2025-11-06T10:00:00.150Z",
		statusCode: 200,
		responseHeaders: { "content-type": "application/json" },
		location: { file: SPEC_FILE, line, column: 17 },
		...extra,
	};
}

async function report(
	steps: StepDefinition[],
	requests: CapturedApiRequest[] | string,
): Promise<Span[]> {
	await runReporterTest({
		test: { title: "cart" },
		result: {
			steps,
			attachments: [
				retainedTraceAttachment(),
				{
					name: API_REQUESTS_ATTACHMENT_NAME,
					contentType: "application/json",
					body: Buffer.from(
						typeof requests === "string"
							? requests
							: JSON.stringify({ requests }),
					),
				},
			],
		},
	});
	return vi.mocked(sendSpans).mock.calls[0][0];
}

function stepSpans(spans: Span[]): Span[] {
	return spans.filter((span) => span.name === TEST_STEP_SPAN_NAME);
}

describe("PlaywrightOpentelemetryReporter - API requests", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("makes a request step the HTTP client span of its request", async () => {
		const spans = await report(
			[
				{
					title: "Seed cart",
					steps: [requestStep("POST", "/api/cart?currency=sek", 17)],
				},
			],
			[
				recorded("POST", "/api/cart?currency=sek", 17, {
					statusCode: 201,
					responseHeaders: {
						"cache-control": "no-store",
						"content-type": "application/json",
					},
				}),
			],
		);

		const [seed, post] = stepSpans(spans);
		expect(spans).toHaveLength(3);
		expect(post.parentSpanId).toBe(seed.spanId);
		expect(post.kind).toBe(3);
		expect(post.status).toBeUndefined();
		expect(post.attributes).toEqual(
			expect.objectContaining({
				[ATTR_TEST_STEP_TITLE]: "POST",
				[ATTR_CODE_FILE_PATH]: SPEC_FILE,
				[ATTR_CODE_LINE_NUMBER]: 17,
				[ATTR_CODE_COLUMN_NUMBER]: 17,
				"http.request.method": "POST",
				"http.response.status_code": 201,
				"http.response.header.cache-control": ["no-store"],
				"http.response.header.content-type": ["application/json"],
				"http.resource.type": "fetch",
				"playwright.request.api": true,
				"url.full": "https://shop.example.com/api/cart?currency=sek",
				"url.path": "/api/cart",
				"url.query": "currency=sek",
				"server.address": "shop.example.com",
				"server.port": 443,
			}),
		);
	});

	it("pairs calls from one line with that line's steps in order", async () => {
		const spans = await report(
			[
				requestStep("GET", "/api/status", 20),
				requestStep("GET", "/api/cart", 25),
				requestStep("GET", "/api/status", 20),
			],
			[
				recorded("GET", "/api/status", 20, { statusCode: 503 }),
				recorded("GET", "/api/cart", 25, { statusCode: 200 }),
				recorded("GET", "/api/status", 20, { statusCode: 200 }),
			],
		);

		expect(
			stepSpans(spans).map((span) => [
				span.attributes["url.path"],
				span.attributes["http.response.status_code"],
				span.attributes["error.type"],
			]),
		).toEqual([
			["/api/status", 503, "503"],
			["/api/cart", 200, undefined],
			["/api/status", 200, undefined],
		]);
	});

	it("tells apart concurrent calls from one line by their url", async () => {
		const spans = await report(
			[
				requestStep("GET", "/api/items/2", 30),
				requestStep("GET", "/api/items/1", 30),
			],
			[
				recorded("GET", "/api/items/1", 30, { statusCode: 200 }),
				recorded("GET", "/api/items/2", 30, { statusCode: 404 }),
			],
		);

		expect(
			stepSpans(spans).map((span) => [
				span.attributes["url.path"],
				span.attributes["http.response.status_code"],
			]),
		).toEqual([
			["/api/items/2", 404],
			["/api/items/1", 200],
		]);
	});

	it("matches a url Playwright cut short", async () => {
		const url = `/api/${"long/".repeat(60)}end`;
		const spans = await report(
			[requestStep("GET", `${url.slice(0, 200)}…`, 30)],
			[recorded("GET", "/api/other", 30), recorded("GET", url, 30)],
		);

		expect(stepSpans(spans)[0].attributes["url.full"]).toBe(
			`https://shop.example.com${url}`,
		);
	});

	it("reports the error of a call that got no response", async () => {
		const spans = await report(
			[
				requestStep("GET", "/api/cart", 17, {
					error: { message: "apiRequestContext.get: connect ECONNREFUSED" },
				}),
			],
			[
				recorded("GET", "/api/cart", 17, {
					responseUrl: undefined,
					statusCode: undefined,
					responseHeaders: undefined,
					errorType: "Error",
				}),
			],
		);

		const [get] = stepSpans(spans);
		expect(get.status).toEqual({
			code: 2,
			message: "apiRequestContext.get: connect ECONNREFUSED",
		});
		expect(get.attributes).toEqual(
			expect.objectContaining({
				"http.request.method": "GET",
				"url.full": "/api/cart",
				"error.type": "Error",
			}),
		);
		expect(get.attributes).not.toHaveProperty("http.response.status_code");
	});

	it.each([
		["Playwright 1.52 to 1.62", { title: 'GET "/api/cart"' }, "GET"],
		[
			"Playwright 1.51 and older",
			{ title: "apiRequestContext.post(/api/cart)" },
			"POST",
		],
		[
			"a fetch() without a method",
			{ title: "{method}", params: { url: "/api/cart" } },
			"GET",
		],
	])("recognises the request step of %s", async (_name, step, method) => {
		const spans = await report(
			[
				{
					category: "pw:api",
					location: {
						file: `${DEFAULT_ROOT_DIR}/${SPEC_FILE}`,
						line: 17,
						column: 17,
					},
					...step,
				},
			],
			[recorded(method, "/api/cart", 17, { statusCode: 204 })],
		);

		expect(spans).toHaveLength(2);
		expect(stepSpans(spans)[0].attributes).toEqual(
			expect.objectContaining({
				"http.request.method": method,
				"http.response.status_code": 204,
			}),
		);
	});

	it("describes a request the fixture didn't record from its step", async () => {
		const spans = await report(
			[
				requestStep("PUT", "https://shop.example.com/api/cart/1", 12),
				{
					title: "Navigate",
					category: "pw:api",
					params: { url: "https://shop.example.com/" },
					location: { file: `${DEFAULT_ROOT_DIR}/${SPEC_FILE}`, line: 13 },
				},
				{
					...requestStep("GET", "/api/cart", 14),
					title: 'GET "/api/cart"',
					params: undefined,
				},
			],
			[],
		);

		const [put, navigate, oldGet] = stepSpans(spans);
		expect(put.kind).toBe(3);
		expect(put.attributes).toEqual(
			expect.objectContaining({
				"http.request.method": "PUT",
				"playwright.request.api": true,
				"url.full": "https://shop.example.com/api/cart/1",
				"url.path": "/api/cart/1",
			}),
		);
		expect(put.attributes).not.toHaveProperty("http.response.status_code");
		// Not a request, and a request step that doesn't report its url.
		for (const span of [navigate, oldGet]) {
			expect(span.kind).toBeUndefined();
			expect(span.attributes).not.toHaveProperty("http.request.method");
		}
	});

	it("leaves the steps of other calls on the same line alone", async () => {
		const spans = await report(
			[
				requestStep("GET", "/api/cart", 17),
				{
					title: "Expect",
					category: "expect",
					location: {
						file: `${DEFAULT_ROOT_DIR}/${SPEC_FILE}`,
						line: 17,
						column: 3,
					},
				},
			],
			[recorded("GET", "/api/cart", 17)],
		);

		const [get, expectation] = stepSpans(spans);
		expect(get.attributes["http.response.status_code"]).toBe(200);
		expect(expectation.attributes).not.toHaveProperty("http.request.method");
		expect(spans).toHaveLength(3);
	});

	it("keeps a recorded call no step reported, under the test", async () => {
		const spans = await report(
			[requestStep("GET", "/api/cart", 17)],
			[
				recorded("GET", "/api/cart", 17),
				recorded("DELETE", "/api/cart/1", 40, { statusCode: 500 }),
			],
		);

		const [testSpan] = spans;
		const unmatched = spans.find((span) => span.name === "HTTP DELETE")!;
		expect(spans).toHaveLength(3);
		expect(unmatched).toEqual(
			expect.objectContaining({
				parentSpanId: testSpan.spanId,
				kind: 3,
				status: { code: 2 },
				startTime: new Date("2025-11-06T10:00:00.100Z"),
				endTime: new Date("2025-11-06T10:00:00.150Z"),
			}),
		);
		expect(unmatched.attributes).toEqual(
			expect.objectContaining({
				[ATTR_CODE_FILE_PATH]: SPEC_FILE,
				[ATTR_CODE_LINE_NUMBER]: 40,
				[ATTR_CODE_COLUMN_NUMBER]: 17,
				"http.request.method": "DELETE",
				"http.response.status_code": 500,
			}),
		);
	});

	it("still locates requests if Playwright reports the fixture's wrapper as their location", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const wrapper = { file: API_REQUEST_WRAPPER_FILE, line: 5, column: 20 };
		const spans = await report(
			[
				requestStep("GET", "/api/cart", 0, { location: wrapper }),
				requestStep("POST", "/api/cart", 0, { location: wrapper }),
			],
			[
				recorded("GET", "/api/cart", 17),
				recorded("POST", "/api/cart", 18, { statusCode: 201 }),
			],
		);

		expect(
			stepSpans(spans).map((span) => [
				span.attributes[ATTR_CODE_FILE_PATH],
				span.attributes[ATTR_CODE_LINE_NUMBER],
				span.attributes["http.response.status_code"],
			]),
		).toEqual([
			[SPEC_FILE, 17, 200],
			[SPEC_FILE, 18, 201],
		]);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("request wrapper as the location"),
		);
		warn.mockRestore();
	});

	it("ignores requests it can't read", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const spans = await report([requestStep("GET", "/api/cart", 17)], "null");

		expect(stepSpans(spans)).toHaveLength(1);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(
				`Ignoring invalid ${API_REQUESTS_ATTACHMENT_NAME}`,
			),
		);
		warn.mockRestore();
	});

	it("leaves out the request steps of a fixture that wrapped request in a Proxy", async () => {
		const spans = await report(
			[
				requestStep("GET", "/api/cart", 15, {
					location: {
						file: "/project/node_modules/playwright-opentelemetry/dist/fixture.mjs",
						line: 15,
					},
				}),
			],
			[],
		);

		expect(stepSpans(spans)).toEqual([]);
	});

	it("reads the requests the fixture left in the handoff directory", async () => {
		const outputDir = temporaryOutputDir();
		const dir = fixtureHandoffDir(outputDir, "file-0-test-0", 0);
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(
			path.join(dir, TRACE_CONTEXT_HANDOFF_FILE),
			JSON.stringify({
				traceId: generateTraceId(),
				rootSpanId: generateSpanId(),
			}),
		);
		await fs.writeFile(
			path.join(dir, API_REQUESTS_HANDOFF_FILE),
			JSON.stringify({ requests: [recorded("GET", "/api/cart", 17)] }),
		);

		await runReporterTest({
			config: { outputDir },
			test: { id: "file-0-test-0", title: "cart" },
			result: {
				steps: [requestStep("GET", "/api/cart", 17)],
				attachments: [retainedTraceAttachment()],
			},
			includeTraceContextAttachment: false,
		});

		const spans: Span[] = vi.mocked(sendSpans).mock.calls[0][0];
		expect(stepSpans(spans)[0].attributes["http.response.status_code"]).toBe(
			200,
		);
	});
});
