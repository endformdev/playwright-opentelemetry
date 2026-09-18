import type { APIRequestContext, APIResponse } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { createCapturedApiRequestContext } from "../src/fixture/api-request-capture";
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
