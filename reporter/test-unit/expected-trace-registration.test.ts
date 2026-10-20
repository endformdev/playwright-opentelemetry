import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	flushFixtureSpans,
	registerExpectedTrace,
	type TestTraceContext,
	WorkerTraceExporter,
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

describe("worker trace exporter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = fetchMock;
	});

	it("hands each test a trace registered while earlier tests ran", async () => {
		const responses = deferredResponses();
		fetchMock.mockImplementation(() => responses.next());
		const exporter = new WorkerTraceExporter();
		const config = resolvePlaywrightOpentelemetryConfig({
			playwrightTraceApiEndpoint: { url: "https://trace-api.example.com" },
		});

		const first = exporter.takeTraceId(config, { trace: "on" });
		// Three registrations for upcoming tests, then the first test's own
		expect(registeredTraceIds()).toHaveLength(4);
		responses.resolve(3);
		const firstTraceId = await first;
		expect(firstTraceId).toBe(registeredTraceIds()[3]);

		responses.resolve(0);
		// Resolves without waiting for the registration it starts for a later test
		const secondTraceId = await exporter.takeTraceId(config, { trace: "on" });

		expect(secondTraceId).toBe(registeredTraceIds()[0]);
		expect(registeredTraceIds()).toHaveLength(5);
	});

	it("registers synchronously when the destinations change", async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
		const exporter = new WorkerTraceExporter();
		await exporter.takeTraceId(
			resolvePlaywrightOpentelemetryConfig({
				playwrightTraceApiEndpoint: { url: "https://first.example.com" },
			}),
			{ trace: "on" },
		);

		const traceId = await exporter.takeTraceId(
			resolvePlaywrightOpentelemetryConfig({
				playwrightTraceApiEndpoint: { url: "https://second.example.com" },
			}),
			{ trace: "on" },
		);

		const registrations = fetchMock.mock.calls.filter(
			([, init]) => init.headers["x-trace-id"] === traceId,
		);
		expect(registrations.map(([url]) => url)).toEqual([
			"https://second.example.com/playwright-otel-reporter/v1/expected-trace",
		]);
	});

	it("sends fixture spans after the test and waits for them when draining", async () => {
		const responses = deferredResponses();
		fetchMock.mockImplementation(() => responses.next());
		const exporter = new WorkerTraceExporter();
		const context = traceContext();
		context.spans.push(fixtureSpan(context));

		await flushFixtureSpans(
			context,
			resolvePlaywrightOpentelemetryConfig({
				playwrightTraceApiEndpoint: { url: "https://trace-api.example.com" },
			}),
			{ trace: "on", exporter },
		);
		let drained = false;
		const draining = exporter.drain(1_000).then(() => {
			drained = true;
		});
		await Promise.resolve();

		expect(fetchMock).toHaveBeenCalledWith(
			"https://trace-api.example.com/v1/traces",
			expect.objectContaining({ method: "POST" }),
		);
		expect(drained).toBe(false);
		responses.resolve(0);
		await draining;
	});

	it("warns instead of failing the test when a background send fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		fetchMock.mockResolvedValue({
			ok: false,
			status: 503,
			statusText: "Service Unavailable",
			text: async () => "down",
		});
		const exporter = new WorkerTraceExporter();
		const context = traceContext();
		context.spans.push(fixtureSpan(context));

		await flushFixtureSpans(
			context,
			resolvePlaywrightOpentelemetryConfig({
				playwrightTraceApiEndpoint: { url: "https://trace-api.example.com" },
			}),
			{ trace: "on", exporter },
		);
		await exporter.drain(1_000);

		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("Failed to send Playwright fixture spans: "),
		);
		warn.mockRestore();
	});
});

function registeredTraceIds(): string[] {
	return fetchMock.mock.calls
		.filter(([url]) => String(url).endsWith("/expected-trace"))
		.map(([, init]) => init.headers["x-trace-id"]);
}

function deferredResponses() {
	const resolvers: Array<() => void> = [];
	return {
		next: () =>
			new Promise((resolve) => {
				resolvers.push(() =>
					resolve({ ok: true, status: 200, statusText: "OK" }),
				);
			}),
		resolve: (index: number) => resolvers[index]?.(),
	};
}

function fixtureSpan(context: TestTraceContext): TestTraceContext["spans"][0] {
	return {
		traceId: context.traceId,
		spanId: "0123456789abcdef",
		parentSpanId: context.rootSpanId,
		name: "browser.page",
		startTime: new Date("2025-11-06T10:00:00.000Z"),
		endTime: new Date("2025-11-06T10:00:01.000Z"),
		attributes: {},
		events: [],
	};
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
		addSpan(span) {
			this.spans.push(span);
		},
	};
}
