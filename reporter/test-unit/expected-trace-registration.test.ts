import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	registerExpectedTrace,
	type TestTraceContext,
} from "../src/fixture/trace-context";
import { resolvePlaywrightOpentelemetryConfig } from "../src/shared/config";
import {
	PLAYWRIGHT_TRACE_API_SOURCE_HEADER,
	PLAYWRIGHT_TRACE_API_SOURCE_REPORTER,
} from "../src/shared/otel";

const fetchMock = vi.fn();

describe("expected trace registration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = fetchMock;
		fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
	});

	it("skips Trace API marker registration when the trace cannot be retained before the test runs", async () => {
		await registerExpectedTrace(
			traceContext(),
			resolvePlaywrightOpentelemetryConfig({
				playwrightTraceApiEndpoint: { url: "https://trace-api.example.com" },
			}),
			{
				trace: "on-first-retry",
				testInfo: { retry: 0 },
			},
		);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("registers markers only for destinations whose resolved trace mode could retain", async () => {
		const context = traceContext();

		await registerExpectedTrace(
			context,
			resolvePlaywrightOpentelemetryConfig({
				trace: "off",
				playwrightTraceApiEndpoints: [
					{
						url: "https://kept-failure.example.com",
						headers: { Authorization: "Bearer kept" },
						trace: "retain-on-failure",
					},
					{
						url: "https://kept-retry.example.com",
						trace: "on-first-retry",
					},
					{ url: "https://discarded.example.com", trace: "off" },
					{ url: "https://inherited-off.example.com" },
				],
			}),
			{
				trace: "on",
				testInfo: { retry: 1 },
			},
		);

		expect(expectedTraceUrls()).toEqual([
			"https://kept-failure.example.com/playwright-otel-reporter/v1/expected-trace",
			"https://kept-retry.example.com/playwright-otel-reporter/v1/expected-trace",
		]);
		expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
			"x-trace-id": context.traceId,
			[PLAYWRIGHT_TRACE_API_SOURCE_HEADER]:
				PLAYWRIGHT_TRACE_API_SOURCE_REPORTER,
			Authorization: "Bearer kept",
		});
	});
});

function expectedTraceUrls(): string[] {
	return fetchMock.mock.calls.map(([url]) => String(url));
}

function traceContext(): TestTraceContext {
	return {
		traceId: "0123456789abcdef0123456789abcdef",
		rootSpanId: "0123456789abcdef",
		spans: [],
		requestContexts: new WeakMap(),
		addSpan() {},
	};
}
