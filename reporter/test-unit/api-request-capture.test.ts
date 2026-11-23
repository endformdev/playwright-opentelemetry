import fs from "node:fs/promises";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import {
	createCapturedApiRequestContext,
	startApiRequestHar,
} from "../src/fixture/api-request-capture";
import {
	API_REQUESTS_ATTACHMENT_NAME,
	apiRequestsFromHar,
} from "../src/shared/api-requests";
import type { TestTraceContext } from "../src/fixture/trace-context";
import { generateSpanId, generateTraceId } from "../src/shared/otel";

describe("API request capture", () => {
	it("captures allow-listed response headers as string arrays", async () => {
		const response = {
			status: () => 200,
			headers: () => ({
				"cache-control": "public, max-age=31536000, immutable",
				"content-type": "application/json",
			}),
		} as unknown as APIResponse;
		const request = {
			get: vi.fn().mockResolvedValue(response),
		} as unknown as APIRequestContext;
		const traceContext = createTraceContext();
		const capturedRequest = createCapturedApiRequestContext(
			request,
			traceContext,
		);

		await capturedRequest.get("https://api.example.com/data");

		expect(traceContext.spans[0].attributes).toEqual(
			expect.objectContaining({
				"http.response.header.cache-control": [
					"public, max-age=31536000, immutable",
				],
				"http.response.header.content-type": ["application/json"],
			}),
		);
	});
});

function createTraceContext(): TestTraceContext {
	return {
		traceId: generateTraceId(),
		rootSpanId: generateSpanId(),
		spans: [],
		requestContexts: new WeakMap(),
		addSpan(span) {
			this.spans.push(span);
		},
	};
}

describe("API request HAR", () => {
	it("keeps only what the reporter needs from a HAR", () => {
		expect(
			apiRequestsFromHar({
				log: {
					entries: [
						{
							startedDateTime: "2026-11-23T08:00:00.000Z",
							request: {
								method: "POST",
								url: "https://api.example.com/login?next=%2F",
								headers: [{ name: "Authorization", value: "Bearer secret" }],
								cookies: [{ name: "session", value: "secret" }],
							},
							response: {
								status: 302,
								redirectURL: "/home",
								headers: [
									{ name: "Content-Type", value: "text/html" },
									{ name: "Set-Cookie", value: "session=secret" },
									{ name: "Cache-Control", value: "no-store" },
								],
							},
						},
						{
							startedDateTime: "2026-11-23T08:00:01.000Z",
							request: { method: "GET", url: "http://127.0.0.1:1/refused" },
							response: { status: -1, redirectURL: "", headers: [] },
						},
						{ request: { method: "GET" } },
					],
				},
			}),
		).toEqual([
			{
				method: "POST",
				url: "https://api.example.com/login?next=%2F",
				startTime: "2026-11-23T08:00:00.000Z",
				status: 302,
				redirectUrl: "/home",
				responseHeaders: {
					"content-type": "text/html",
					"cache-control": "no-store",
				},
			},
			{
				method: "GET",
				url: "http://127.0.0.1:1/refused",
				startTime: "2026-11-23T08:00:01.000Z",
				status: -1,
				responseHeaders: {},
			},
		]);
	});

	it("falls back when the context has no startHar", async () => {
		const testInfo = createTestInfo();
		const request = {} as APIRequestContext;

		await expect(
			startApiRequestHar(request, { attachFixtureData: true, testInfo }),
		).resolves.toBeUndefined();
	});

	it("falls back when startHar fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const testInfo = createTestInfo();
		const request = createHarRequest({
			startHar: vi.fn().mockRejectedValue(new Error("already started")),
		});

		await expect(
			startApiRequestHar(request, { attachFixtureData: true, testInfo }),
		).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("already started"),
		);
		warn.mockRestore();
	});

	it("attaches the recorded requests with attachFixtureData", async () => {
		const testInfo = createTestInfo();
		let harPath = "";
		const request = createHarRequest({
			startHar: vi.fn(async (path: string) => {
				harPath = path;
			}),
			stopHar: vi.fn(async () => {
				await fs.writeFile(
					harPath,
					JSON.stringify({
						log: {
							entries: [
								{
									startedDateTime: "2026-11-23T08:00:00.000Z",
									request: { method: "GET", url: "https://api.example.com/" },
									response: { status: 200, headers: [] },
								},
							],
						},
					}),
				);
			}),
		});

		const har = await startApiRequestHar(request, {
			attachFixtureData: true,
			testInfo,
		});
		await har?.stop();

		expect(testInfo.attach).toHaveBeenCalledWith(API_REQUESTS_ATTACHMENT_NAME, {
			body: JSON.stringify({
				requests: [
					{
						method: "GET",
						url: "https://api.example.com/",
						startTime: "2026-11-23T08:00:00.000Z",
						status: 200,
						responseHeaders: {},
					},
				],
			}),
			contentType: "application/json",
		});
		// The raw HAR, which holds request headers, is removed.
		await expect(fs.access(harPath)).rejects.toThrow();
	});

	it("does not fail the test when the HAR can't be exported", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const testInfo = createTestInfo();
		const request = createHarRequest({
			stopHar: vi.fn().mockRejectedValue(new Error("context closed")),
		});

		const har = await startApiRequestHar(request, {
			attachFixtureData: true,
			testInfo,
		});
		await expect(har?.stop()).resolves.toBeUndefined();
		expect(testInfo.attach).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("context closed"),
		);
		warn.mockRestore();
	});
});

function createTestInfo() {
	return {
		project: { outputDir: "/tmp/unused" },
		retry: 0,
		testId: "test-id",
		attach: vi.fn(),
	} as unknown as Parameters<typeof startApiRequestHar>[1]["testInfo"] & {
		attach: ReturnType<typeof vi.fn>;
	};
}

function createHarRequest(tracing: {
	startHar?: ReturnType<typeof vi.fn>;
	stopHar?: ReturnType<typeof vi.fn>;
}): APIRequestContext {
	return {
		tracing: {
			startHar: tracing.startHar ?? vi.fn(),
			stopHar: tracing.stopHar ?? vi.fn(),
		},
	} as unknown as APIRequestContext;
}
