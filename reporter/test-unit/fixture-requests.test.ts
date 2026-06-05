import type { Request, Response } from "@playwright/test";
import { describe, expect, it } from "vitest";
import {
	detectResourceType,
	fixtureCaptureRequestResponse,
} from "../src/fixture/request-response-capture";
import type { TestTraceContext } from "../src/fixture/trace-context";
import { generateSpanId, generateTraceId } from "../src/shared/otel";

describe("fixture request/response capture", () => {
	it("skips requests without propagated in-memory context", async () => {
		const traceContext = createTraceContext();

		await fixtureCaptureRequestResponse({
			request: createRequest("https://example.com/fulfilled-by-user-route"),
			response: createResponse(200, "application/json"),
			traceContext,
		});

		expect(traceContext.spans).toEqual([]);
	});

	it("builds HTTP client spans from stored request context", async () => {
		const traceContext = createTraceContext();
		const request = createRequest("https://api.example.com:443/users?q=1");
		traceContext.requestContexts.set(request, {
			traceId: traceContext.traceId,
			spanId: "2222222222222222",
			parentSpanId: traceContext.rootSpanId,
			routeAssociation: "active-page",
		});

		await fixtureCaptureRequestResponse({
			request,
			response: createResponse(404, "application/json"),
			traceContext,
		});

		expect(traceContext.spans).toEqual([
			expect.objectContaining({
				traceId: traceContext.traceId,
				spanId: "2222222222222222",
				parentSpanId: traceContext.rootSpanId,
				name: "HTTP GET",
				kind: 3,
				status: { code: 2 },
				attributes: expect.objectContaining({
					"http.request.method": "GET",
					"http.response.status_code": 404,
					"server.address": "api.example.com",
					"server.port": 443,
					"url.full": "https://api.example.com:443/users?q=1",
					"url.path": "/users",
					"url.query": "q=1",
					"http.resource.type": "fetch",
					"browser.request.route_association": "active-page",
					"error.type": "404",
				}),
			}),
		]);
	});

	it("detects browser resource types from content-type and URL fallback", () => {
		expect(detectResourceType("text/html", "https://example.com")).toBe(
			"document",
		);
		expect(
			detectResourceType("text/javascript", "https://example.com/app"),
		).toBe("script");
		expect(
			detectResourceType("image/svg+xml", "https://example.com/icon"),
		).toBe("image");
		expect(detectResourceType(null, "https://example.com/app.wasm")).toBe(
			"script",
		);
		expect(
			detectResourceType("application/octet-stream", "https://x/a.png"),
		).toBe("image");
		expect(detectResourceType("application/unknown", "https://x/a.bin")).toBe(
			"other",
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

function createRequest(url: string): Request {
	return {
		url: () => url,
		method: () => "GET",
		timing: () => ({
			startTime: new Date("2025-11-06T10:00:00.000Z").getTime(),
			domainLookupStart: -1,
			domainLookupEnd: -1,
			connectStart: -1,
			connectEnd: -1,
			secureConnectionStart: -1,
			requestStart: 0,
			responseStart: 10,
			responseEnd: 20,
		}),
	} as unknown as Request;
}

function createResponse(status: number, contentType: string): Response {
	return {
		status: () => status,
		headerValue: async (name: string) =>
			name.toLowerCase() === "content-type" ? contentType : null,
	} as Response;
}
