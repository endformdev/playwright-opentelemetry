import { test as base, type TestInfo } from "@playwright/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaywrightOtelTest } from "../src/fixture/playwright-opentelemetry-fixture";
import {
	registerExpectedTrace,
	type TestTraceContext,
} from "../src/fixture/trace-context";
import {
	type PlaywrightOpentelemetryConfig,
	resolvePlaywrightOpentelemetryConfig,
} from "../src/shared/config";
import type { PlaywrightTraceOption } from "../src/shared/playwright-trace";
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

	it("skips Trace API marker registration when trace header propagation is disabled", async () => {
		await registerExpectedTrace(
			traceContext(),
			resolvePlaywrightOpentelemetryConfig({
				playwrightTraceApiEndpoint: { url: "https://trace-api.example.com" },
				propagateTraceHeaders: false,
			}),
			{ trace: "on" },
		);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("runs the test without waiting for the marker and waits for it before finishing", async () => {
		let respond = () => {};
		fetchMock.mockReturnValue(
			new Promise((resolve) => {
				respond = () => resolve({ ok: true, status: 200, statusText: "OK" });
			}),
		);
		const fixture = testTraceContextFixture();
		const use = vi.fn(async () => {
			expect(expectedTraceUrls()).toEqual([
				"https://trace-api.example.com/playwright-otel-reporter/v1/expected-trace",
			]);
		});

		let finished = false;
		const running = fixture(
			{
				playwrightOpentelemetry: {
					playwrightTraceApiEndpoint: { url: "https://trace-api.example.com" },
				},
				trace: "on",
			},
			use,
			{ attach: vi.fn(), retry: 0 } as unknown as TestInfo,
		).then(() => {
			finished = true;
		});
		await vi.waitFor(() => expect(use).toHaveBeenCalledOnce());
		await Promise.resolve();
		expect(finished).toBe(false);

		respond();
		await running;
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

type TestTraceContextFixture = (
	options: {
		playwrightOpentelemetry: PlaywrightOpentelemetryConfig;
		trace: PlaywrightTraceOption;
	},
	use: (traceContext: TestTraceContext) => Promise<void>,
	testInfo: TestInfo,
) => Promise<void>;

function testTraceContextFixture(): TestTraceContextFixture {
	const extend = vi.spyOn(base, "extend").mockReturnValue(base);
	try {
		createPlaywrightOtelTest(base);
		const fixtures = extend.mock.calls[0][0] as Record<string, unknown>;
		const [fixture] = fixtures.testTraceContext as [TestTraceContextFixture];
		return fixture;
	} finally {
		extend.mockRestore();
	}
}

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
