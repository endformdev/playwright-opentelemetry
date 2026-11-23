import { afterEach, describe, expect, it, vi } from "vitest";
import {
	resetTestFetchCaptureForTest,
	runWithTestFetchCapture,
} from "../src/fixture/test-fetch-capture";
import type { TestTraceContext } from "../src/fixture/trace-context";
import { generateSpanId, generateTraceId } from "../src/shared/otel";

const nativeFetch = globalThis.fetch;

describe("test worker fetch capture", () => {
	afterEach(() => {
		resetTestFetchCaptureForTest();
		globalThis.fetch = nativeFetch;
		vi.restoreAllMocks();
	});

	it("captures fetch calls as HTTP client spans under the test root", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			new Response("{}", {
				status: 201,
				headers: {
					"cache-control": "public, max-age=31536000, immutable",
					"content-type": "application/json",
				},
			}),
		);
		globalThis.fetch = fetchMock;
		const traceContext = createTraceContext();

		const response = await runWithTestFetchCapture(traceContext, () =>
			fetch("https://api.example.com:8443/users?q=1", { method: "POST" }),
		);

		expect(response.status).toBe(201);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.example.com:8443/users?q=1",
			{ method: "POST" },
		);
		expect(traceContext.spans).toEqual([
			expect.objectContaining({
				traceId: traceContext.traceId,
				parentSpanId: traceContext.rootSpanId,
				name: "HTTP POST",
				kind: 3,
				status: { code: 0 },
				attributes: expect.objectContaining({
					"http.request.method": "POST",
					"http.resource.type": "fetch",
					"url.full": "https://api.example.com:8443/users?q=1",
					"url.path": "/users",
					"url.query": "q=1",
					"server.address": "api.example.com",
					"server.port": 8443,
					"http.response.status_code": 201,
					"http.response.header.cache-control": [
						"public, max-age=31536000, immutable",
					],
					"http.response.header.content-type": ["application/json"],
				}),
			}),
		]);
	});

	it("marks 4xx and 5xx responses as error spans", async () => {
		globalThis.fetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response("nope", { status: 503 }));
		const traceContext = createTraceContext();

		await runWithTestFetchCapture(traceContext, () =>
			fetch(new Request("https://api.example.com/fail")),
		);

		expect(traceContext.spans[0]).toEqual(
			expect.objectContaining({
				name: "HTTP GET",
				status: { code: 2, message: undefined },
				attributes: expect.objectContaining({
					"http.response.status_code": 503,
					"error.type": "503",
				}),
			}),
		);
	});

	it("marks rejected fetch calls as error spans and rethrows", async () => {
		const error = new TypeError("fetch failed");
		globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(error);
		const traceContext = createTraceContext();

		await expect(
			runWithTestFetchCapture(traceContext, () =>
				fetch("https://api.example.com/network-error"),
			),
		).rejects.toThrow(error);

		expect(traceContext.spans[0]).toEqual(
			expect.objectContaining({
				name: "HTTP GET",
				status: { code: 2, message: "fetch failed" },
				attributes: expect.objectContaining({
					"error.type": "TypeError",
				}),
			}),
		);
	});

	it("sends a traceparent header with the ID of the call's span when propagating", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockImplementation(async () => new Response("ok"));
		globalThis.fetch = fetchMock;
		const traceContext = createTraceContext();
		const request = new Request("https://api.example.com/request", {
			headers: { "x-from": "request" },
		});

		await runWithTestFetchCapture(
			traceContext,
			async () => {
				await fetch("https://api.example.com/none", { method: "POST" });
				await fetch("https://api.example.com/object", {
					headers: { accept: "*/*" },
				});
				await fetch("https://api.example.com/array", {
					headers: [["accept", "*/*"]],
				});
				await fetch("https://api.example.com/headers", {
					headers: new Headers({ accept: "*/*" }),
				});
				await fetch(request);
				await fetch("https://api.example.com/own", {
					headers: { Traceparent: "00-own-trace-01" },
				});
			},
			{ propagateTraceHeaders: true },
		);

		const traceparents = traceContext.spans.map(
			(span) => `00-${traceContext.traceId}-${span.spanId}-01`,
		);
		const sent = fetchMock.mock.calls.map(([, init]) => init);
		expect(sent[0]).toEqual({
			method: "POST",
			headers: { traceparent: traceparents[0] },
		});
		expect(sent[1]?.headers).toEqual({
			accept: "*/*",
			traceparent: traceparents[1],
		});
		expect(sent[2]?.headers).toEqual([
			["accept", "*/*"],
			["traceparent", traceparents[2]],
		]);
		expect(sent[3]?.headers).toBeInstanceOf(Headers);
		expect(Object.fromEntries(sent[3]!.headers as Headers)).toEqual({
			accept: "*/*",
			traceparent: traceparents[3],
		});
		// Headers in the options replace those of the Request.
		expect(Object.fromEntries(sent[4]!.headers as Headers)).toEqual({
			"x-from": "request",
			traceparent: traceparents[4],
		});
		expect(sent[5]?.headers).toEqual({ Traceparent: "00-own-trace-01" });
		expect(new Set(traceparents).size).toBe(6);
	});

	it("does not capture fetch calls outside the active test context", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response("ok", { status: 200 }));
		globalThis.fetch = fetchMock;
		const traceContext = createTraceContext();

		await runWithTestFetchCapture(traceContext, async () => {});
		await fetch("https://api.example.com/outside");

		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.example.com/outside",
			undefined,
		);
		expect(traceContext.spans).toEqual([]);
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
