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
					"url.full": "https://api.example.com:8443/users?q=1",
					"url.path": "/users",
					"url.query": "q=1",
					"server.address": "api.example.com",
					"server.port": 8443,
					"http.response.status_code": 201,
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
