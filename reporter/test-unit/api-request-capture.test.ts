import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { APIRequest, APIRequestContext } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	captureApiRequests,
	captureNewApiRequestContexts,
	handOffApiRequests,
	resetApiRequestCaptureForTest,
	startApiRequestRecording,
} from "../src/fixture/api-request-capture";
import {
	API_REQUEST_WRAPPER_FILE,
	API_REQUESTS_ATTACHMENT_NAME,
	type CapturedApiRequest,
} from "../src/shared/api-requests";
import { resolvePlaywrightOpentelemetryConfig } from "../src/shared/config";
import {
	API_REQUESTS_HANDOFF_FILE,
	fixtureHandoffDir,
} from "../src/shared/fixture-handoff";
import { temporaryOutputDir } from "./reporter-harness";

const ROOT_DIR = path.dirname(import.meta.dirname);
const THIS_FILE = path.join("test-unit", "api-request-capture.test.ts");

type FakeResponse = {
	status(): number;
	url(): string;
	headers(): Record<string, string>;
};

/**
 * Shaped like Playwright's class: `get()` and `post()` go through `fetch()`.
 * A new class per test, because capturing wraps the class's methods.
 */
function createRequestContextClass() {
	return class FakeRequestContext {
		response: FakeResponse = response(200, "https://api.example.com/data");
		failure: Error | undefined;
		/** The stack as Playwright would see it when it locates the step. */
		stacks: string[] = [];
		/** The options Playwright's fetch() was called with. */
		sentOptions: Array<{ headers?: Record<string, string> } | undefined> = [];

		async get(url: string, options?: object) {
			return await this.fetch(url, { ...options, method: "GET" });
		}

		async post(url: string, options?: object) {
			return await this.fetch(url, { ...options, method: "POST" });
		}

		async fetch(_urlOrRequest: unknown, options?: object) {
			this.sentOptions.push(options);
			this.stacks.push(new Error().stack ?? "");
			await Promise.resolve();
			if (this.failure) {
				throw this.failure;
			}
			return this.response;
		}
	};
}

function createCapturedRequestContext() {
	const FakeRequestContext = createRequestContextClass();
	const request = new FakeRequestContext();
	captureApiRequests(request as unknown as APIRequestContext);
	return request;
}

function response(
	status: number,
	url: string,
	headers: Record<string, string> = {},
): FakeResponse {
	return { status: () => status, url: () => url, headers: () => headers };
}

describe("API request capture", () => {
	afterEach(() => {
		resetApiRequestCaptureForTest();
	});

	it("records the response of a call and where the test made it", async () => {
		const request = createCapturedRequestContext();
		request.response = response(201, "https://api.example.com/v2/data", {
			"cache-control": "no-store",
			"content-type": "application/json",
			"set-cookie": "session=secret",
		});
		const recording = startApiRequestRecording({ rootDir: ROOT_DIR });

		const result = await request.post("/data");
		await request.get("https://api.example.com/other");

		expect(result).toBe(request.response);
		const [first, second] = recording.stop();
		expect(first).toEqual({
			method: "POST",
			url: "/data",
			responseUrl: "https://api.example.com/v2/data",
			startTime: expect.any(String),
			endTime: expect.any(String),
			statusCode: 201,
			responseHeaders: {
				"cache-control": "no-store",
				"content-type": "application/json",
			},
			location: {
				file: THIS_FILE,
				line: expect.any(Number),
				column: expect.any(Number),
			},
		});
		// The two calls above are on consecutive lines.
		expect(second.location).toEqual({
			file: THIS_FILE,
			line: first.location!.line + 1,
			column: expect.any(Number),
		});
	});

	it("keeps its own code off the stack Playwright takes a step's location from", async () => {
		const request = createCapturedRequestContext();
		const recording = startApiRequestRecording({ rootDir: ROOT_DIR });

		await request.get("/data");
		recording.stop();

		const frames = request.stacks[0].split("\n").slice(1);
		// fetch, the wrapper around it, get, the wrapper around it, this test.
		expect(frames[1]).toContain(API_REQUEST_WRAPPER_FILE);
		expect(frames[3]).toContain(API_REQUEST_WRAPPER_FILE);
		expect(frames[4]).toContain("api-request-capture.test.ts");
		expect(request.stacks[0]).not.toContain(
			path.join("fixture", "api-request-capture"),
		);
	});

	it("records a call once when its method goes through fetch()", async () => {
		const request = createCapturedRequestContext();
		const recording = startApiRequestRecording({ rootDir: ROOT_DIR });

		await request.get("/data");

		expect(recording.stop()).toEqual([
			expect.objectContaining({ method: "GET", url: "/data" }),
		]);
	});

	it("reads the method and url of a fetch() from its options or its Request", async () => {
		const request = createCapturedRequestContext();
		const recording = startApiRequestRecording({ rootDir: ROOT_DIR });

		await request.fetch("/default");
		await request.fetch("/delete", { method: "delete" });
		await request.fetch({
			url: () => "https://app.example.com/form",
			method: () => "PUT",
		});

		expect(recording.stop().map((call) => [call.method, call.url])).toEqual([
			["GET", "/default"],
			["DELETE", "/delete"],
			["PUT", "https://app.example.com/form"],
		]);
	});

	it("records the error of a failed call and still throws it", async () => {
		const request = createCapturedRequestContext();
		request.failure = new TypeError("connect ECONNREFUSED");
		const recording = startApiRequestRecording({ rootDir: ROOT_DIR });

		await expect(request.get("/data")).rejects.toBe(request.failure);

		expect(recording.stop()).toEqual([
			expect.objectContaining({
				method: "GET",
				errorType: "TypeError",
				endTime: expect.any(String),
			}),
		]);
		expect(recording.stop()[0]).not.toHaveProperty("statusCode");
	});

	it("hands back Playwright's own promise while no test is recording", async () => {
		const FakeRequestContext = createRequestContextClass();
		const original = FakeRequestContext.prototype.fetch;
		const promise = Promise.resolve(response(200, "https://example.com/"));
		FakeRequestContext.prototype.fetch = vi.fn(
			() => promise,
		) as typeof original;
		const request = new FakeRequestContext();
		captureApiRequests(request as unknown as APIRequestContext);

		expect(request.fetch("/data")).toBe(promise);

		const recording = startApiRequestRecording({ rootDir: ROOT_DIR });
		recording.stop();
		expect(request.fetch("/data")).toBe(promise);
		expect(recording.stop()).toEqual([]);
	});

	it("completes a call that outlives its recording", async () => {
		const request = createCapturedRequestContext();
		const recording = startApiRequestRecording({ rootDir: ROOT_DIR });

		const pending = request.get("/slow");
		const requests = recording.stop();
		expect(requests[0]).not.toHaveProperty("endTime");

		await pending;
		expect(requests[0]).toEqual(expect.objectContaining({ statusCode: 200 }));
	});

	it("sends a traceparent header of the test's trace and records its span ID", async () => {
		const request = createCapturedRequestContext();
		const traceId = "0af7651916cd43dd8448eb211c80319c";
		const recording = startApiRequestRecording({ rootDir: ROOT_DIR, traceId });
		const options = { headers: { accept: "application/json" }, timeout: 500 };

		await request.get("/data", options);
		await request.fetch("/data");

		const [get, fetched] = recording.stop();
		expect(get.spanId).toMatch(/^[0-9a-f]{16}$/);
		expect(fetched.spanId).not.toBe(get.spanId);
		expect(request.sentOptions).toEqual([
			{
				headers: {
					accept: "application/json",
					traceparent: `00-${traceId}-${get.spanId}-01`,
				},
				timeout: 500,
				method: "GET",
			},
			{ headers: { traceparent: `00-${traceId}-${fetched.spanId}-01` } },
		]);
		// The test's own object is not changed.
		expect(options).toEqual({
			headers: { accept: "application/json" },
			timeout: 500,
		});
	});

	it("keeps the headers of a Request that fetch() is given", async () => {
		const request = createCapturedRequestContext();
		const recording = startApiRequestRecording({
			rootDir: ROOT_DIR,
			traceId: "0af7651916cd43dd8448eb211c80319c",
		});
		const browserRequest = {
			url: () => "https://app.example.com/form",
			method: () => "POST",
			headers: () => ({ "content-type": "text/plain" }),
		};

		await request.fetch(browserRequest);
		await request.fetch(browserRequest, { headers: { accept: "*/*" } });

		const [first, second] = recording.stop();
		expect(request.sentOptions).toEqual([
			{
				headers: {
					"content-type": "text/plain",
					traceparent: expect.stringContaining(first.spanId!),
				},
			},
			{
				headers: {
					accept: "*/*",
					traceparent: expect.stringContaining(second.spanId!),
				},
			},
		]);
	});

	it("leaves a traceparent header the test sets itself alone", async () => {
		const request = createCapturedRequestContext();
		const recording = startApiRequestRecording({
			rootDir: ROOT_DIR,
			traceId: "0af7651916cd43dd8448eb211c80319c",
		});
		const options = { headers: { Traceparent: "00-own-trace-01" } };

		await request.fetch("/data", options);

		expect(request.sentOptions).toEqual([options]);
		expect(recording.stop()[0]).not.toHaveProperty("spanId");
	});

	it("sends no traceparent header unless it is given a trace", async () => {
		const request = createCapturedRequestContext();
		const recording = startApiRequestRecording({ rootDir: ROOT_DIR });

		await request.fetch("/data");
		await request.fetch("/data", { headers: { accept: "*/*" } });

		expect(request.sentOptions).toEqual([
			undefined,
			{ headers: { accept: "*/*" } },
		]);
		expect(recording.stop()[0]).not.toHaveProperty("spanId");
	});

	it("wraps a class once, however many of its contexts it sees", async () => {
		const FakeRequestContext = createRequestContextClass();
		const first = new FakeRequestContext();
		captureApiRequests(first as unknown as APIRequestContext);
		const wrapped = FakeRequestContext.prototype.get;
		captureApiRequests(
			new FakeRequestContext() as unknown as APIRequestContext,
		);

		expect(FakeRequestContext.prototype.get).toBe(wrapped);
	});

	it("leaves an object that isn't an instance of a class alone", () => {
		const get = vi.fn();
		const request = { get };

		captureApiRequests(request as unknown as APIRequestContext);

		expect(request.get).toBe(get);
		expect(Object.prototype).not.toHaveProperty("get");
	});

	it("records calls on contexts that playwright.request.newContext() creates", async () => {
		const FakeRequestContext = createRequestContextClass();
		const failure = new Error("no context");
		const apiRequest = {
			fail: false,
			async newContext() {
				if (this.fail) {
					throw failure;
				}
				return new FakeRequestContext();
			},
		};
		captureNewApiRequestContexts(apiRequest as unknown as APIRequest);
		captureNewApiRequestContexts(apiRequest as unknown as APIRequest);
		const recording = startApiRequestRecording({ rootDir: ROOT_DIR });

		const request = await apiRequest.newContext();
		await request.get("/data");
		apiRequest.fail = true;
		await expect(apiRequest.newContext()).rejects.toBe(failure);

		expect(request).toBeInstanceOf(FakeRequestContext);
		expect(recording.stop()).toEqual([
			expect.objectContaining({ method: "GET", url: "/data" }),
		]);
	});
});

describe("API request handoff", () => {
	const requests: CapturedApiRequest[] = [
		{
			method: "GET",
			url: "/data",
			startTime: "2026-11-23T10:00:00.000Z",
			statusCode: 200,
		},
	];

	function createTestInfo(status: "passed" | "failed" = "passed") {
		const outputDir = temporaryOutputDir();
		return {
			outputDir,
			testInfo: {
				testId: "file-0-test-0",
				retry: 0,
				project: { outputDir },
				expectedStatus: "passed" as const,
				status,
				attach: vi.fn(),
			},
		};
	}

	function handoffFile(outputDir: string): string {
		return path.join(
			fixtureHandoffDir(outputDir, "file-0-test-0", 0),
			API_REQUESTS_HANDOFF_FILE,
		);
	}

	it("leaves the requests in the attempt's handoff directory", async () => {
		const { outputDir, testInfo } = createTestInfo();

		await handOffApiRequests(
			requests,
			resolvePlaywrightOpentelemetryConfig({ storeTraceZip: true }),
			{ trace: "on", testInfo: testInfo as never },
		);

		expect(
			JSON.parse(await fs.readFile(handoffFile(outputDir), "utf-8")),
		).toEqual({ requests });
		expect(testInfo.attach).not.toHaveBeenCalled();
	});

	it("attaches the requests with attachFixtureData", async () => {
		const { outputDir, testInfo } = createTestInfo();

		await handOffApiRequests(
			requests,
			resolvePlaywrightOpentelemetryConfig({
				storeTraceZip: true,
				attachFixtureData: true,
			}),
			{ trace: "on", testInfo: testInfo as never },
		);

		expect(testInfo.attach).toHaveBeenCalledWith(API_REQUESTS_ATTACHMENT_NAME, {
			body: JSON.stringify({ requests }),
			contentType: "application/json",
		});
		expect(existsSync(handoffFile(outputDir))).toBe(false);
	});

	it("hands nothing over for a test that isn't kept, or made no requests", async () => {
		const config = resolvePlaywrightOpentelemetryConfig({
			storeTraceZip: true,
			attachFixtureData: true,
		});
		const passed = createTestInfo("passed");
		await handOffApiRequests(requests, config, {
			trace: "retain-on-failure",
			testInfo: passed.testInfo as never,
		});
		const withoutRequests = createTestInfo();
		await handOffApiRequests([], config, {
			trace: "on",
			testInfo: withoutRequests.testInfo as never,
		});

		expect(passed.testInfo.attach).not.toHaveBeenCalled();
		expect(withoutRequests.testInfo.attach).not.toHaveBeenCalled();

		const failed = createTestInfo("failed");
		await handOffApiRequests(requests, config, {
			trace: "retain-on-failure",
			testInfo: failed.testInfo as never,
		});
		expect(failed.testInfo.attach).toHaveBeenCalled();
	});

	it("warns instead of failing the test when the requests can't be stored", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { testInfo } = createTestInfo();
		testInfo.attach.mockRejectedValue(new Error("disk full"));

		await handOffApiRequests(
			requests,
			resolvePlaywrightOpentelemetryConfig({
				storeTraceZip: true,
				attachFixtureData: true,
			}),
			{ trace: "on", testInfo: testInfo as never },
		);

		expect(warn).toHaveBeenCalledWith(
			"Failed to store API requests: disk full",
		);
		warn.mockRestore();
	});
});
