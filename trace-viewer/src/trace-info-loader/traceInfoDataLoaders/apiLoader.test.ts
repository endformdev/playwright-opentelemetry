import { afterEach, describe, expect, it, vi } from "vitest";
import { TraceAccessError } from "../traceAccessError";
import { loadRemoteApi } from "./apiLoader";
import { loadScreenshotsInPage } from "./pageScreenshots";
import { ensureServiceWorker, loadScreenshotsForTrace } from "./zipLoader";

vi.mock("./zipLoader", () => ({
	ensureServiceWorker: vi.fn(async () => ({})),
	unloadCurrentTrace: vi.fn(async () => undefined),
	loadScreenshotsForTrace: vi.fn(),
}));

vi.mock("./pageScreenshots", () => ({
	loadScreenshotsInPage: vi.fn(),
}));

describe("loading a trace from the remote trace API", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	it("loads trace data, derives test header metadata, and builds screenshot URLs", async () => {
		const traceId = "7709187832dca84f02f413a312421586";
		vi.mocked(loadScreenshotsForTrace).mockResolvedValueOnce([
			{
				timestamp: 1766927492100,
				url: `/playwright-otel-trace-viewer/v1/${traceId}/screenshots/page@abc-1766927492100.jpeg`,
				pageId: "page@abc",
			},
			{
				timestamp: 1766927492300,
				url: `/playwright-otel-trace-viewer/v1/${traceId}/screenshots/page@abc-1766927492300.jpeg`,
				pageId: "page@abc",
			},
		]);
		const fetchMock = vi.fn(async (url: string) => {
			if (url === `https://traces.example.com/${traceId}/traces`) {
				return jsonResponse(otlpExport(traceId));
			}
			return textResponse("not found", 404);
		});
		vi.stubGlobal("fetch", fetchMock);

		const traceInfo = await loadRemoteApi(
			`https://traces.example.com/${traceId}/`,
			null,
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			`https://traces.example.com/${traceId}/traces`,
		);
		expect(traceInfo.testInfo).toEqual({
			name: "checkout completes",
			describes: ["Checkout", "Happy path"],
			file: "tests/checkout.spec.ts",
			line: 42,
			status: "passed",
			traceId,
			startTimeUnixNano: "1766927492000000000",
			endTimeUnixNano: "1766927493000000000",
		});
		expect(traceInfo.traceData.resourceSpans).toHaveLength(2);

		expect(await traceInfo.loadScreenshots()).toEqual([
			{
				timestamp: 1766927492100,
				url: `/playwright-otel-trace-viewer/v1/${traceId}/screenshots/page@abc-1766927492100.jpeg`,
				pageId: "page@abc",
			},
			{
				timestamp: 1766927492300,
				url: `/playwright-otel-trace-viewer/v1/${traceId}/screenshots/page@abc-1766927492300.jpeg`,
				pageId: "page@abc",
			},
		]);
		expect(loadScreenshotsForTrace).toHaveBeenCalledWith(
			traceId,
			`https://traces.example.com/${traceId}/screenshots.zip`,
		);
	});

	it("propagates trace tokens to trace API requests", async () => {
		const traceId = "7709187832dca84f02f413a312421586";
		const fetchMock = vi.fn(async (url: string) => {
			if (
				url ===
				`https://traces.example.com/${traceId}/traces?traceToken=token%20123`
			) {
				return jsonResponse(otlpExport(traceId));
			}
			return textResponse("not found", 404);
		});
		vi.stubGlobal("fetch", fetchMock);

		const traceInfo = await loadRemoteApi(
			`https://traces.example.com/${traceId}/`,
			"token 123",
		);

		expect(fetchMock).toHaveBeenCalledWith(
			`https://traces.example.com/${traceId}/traces?traceToken=token%20123`,
		);
		await traceInfo.loadScreenshots();
		expect(loadScreenshotsForTrace).toHaveBeenCalledWith(
			traceId,
			`https://traces.example.com/${traceId}/screenshots.zip?traceToken=token%20123`,
		);
	});

	it("surfaces a missing trace before trying to load screenshots", async () => {
		const traceId = "7709187832dca84f02f413a312421586";
		const fetchMock = vi.fn(async (url: string) => {
			if (url === `https://traces.example.com/${traceId}/traces`) {
				return textResponse("Trace not found", 404);
			}
			return new Response(null, { status: 404 });
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			loadRemoteApi(`https://traces.example.com/${traceId}`, null),
		).rejects.toThrow("Failed to fetch trace data");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("reports the reason the trace API gives for refusing access", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => jsonResponse({ code: "token_invalid" }, 401)),
		);

		await expect(
			loadRemoteApi("https://traces.example.com/trace-id", null),
		).rejects.toBeInstanceOf(TraceAccessError);
	});

	it("falls back to the generic error when a 401 gives no reason", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => textResponse("Unauthorized", 401)),
		);

		await expect(
			loadRemoteApi("https://traces.example.com/trace-id", null),
		).rejects.toThrow("401 Unauthorized");
	});

	it("keeps the trace token out of a failed load's message", async () => {
		const traceId = "7709187832dca84f02f413a312421586";
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => textResponse("Trace not found", 404)),
		);

		const error = await loadRemoteApi(
			`https://traces.example.com/${traceId}`,
			"secret-token",
		).catch((error: unknown) => error);

		expect(String(error)).toContain(
			`https://traces.example.com/${traceId}/traces: 404`,
		);
		expect(String(error)).not.toContain("secret-token");
	});

	it("fails clearly when the trace API returns data without a Playwright root span", async () => {
		const traceId = "7709187832dca84f02f413a312421586";
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (url.endsWith("/traces")) {
					return jsonResponse(otlpExport(traceId, { includeTestSpan: false }));
				}
				return new Response(null, { status: 404 });
			}),
		);

		await expect(
			loadRemoteApi(`https://traces.example.com/${traceId}`, null),
		).rejects.toThrow("no playwright.test span found");
	});

	describe("loading screenshots", () => {
		const traceId = "7709187832dca84f02f413a312421586";
		const screenshotsZipUrl = `https://traces.example.com/${traceId}/screenshots.zip`;
		const screenshots = [
			{ timestamp: 1, url: "blob:null/screenshot", pageId: "page@abc" },
		];

		async function loadTrace() {
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => jsonResponse(otlpExport(traceId))),
			);
			return loadRemoteApi(`https://traces.example.com/${traceId}`, null);
		}

		it("loads them in the page when there's no service worker", async () => {
			vi.spyOn(console, "info").mockImplementationOnce(() => undefined);
			vi.mocked(ensureServiceWorker).mockRejectedValueOnce(
				new Error("Service workers are not available in this page"),
			);
			vi.mocked(loadScreenshotsInPage).mockResolvedValueOnce(screenshots);
			const traceInfo = await loadTrace();

			expect(await traceInfo.loadScreenshots()).toEqual(screenshots);
			expect(loadScreenshotsInPage).toHaveBeenCalledWith(screenshotsZipUrl);
			expect(loadScreenshotsForTrace).not.toHaveBeenCalled();
		});

		it("loads them in the page when a service worker never takes control", async () => {
			vi.useFakeTimers();
			vi.spyOn(console, "info").mockImplementationOnce(() => undefined);
			vi.mocked(ensureServiceWorker).mockReturnValueOnce(
				new Promise(() => undefined),
			);
			vi.mocked(loadScreenshotsInPage).mockResolvedValueOnce(screenshots);
			const traceInfo = await loadTrace();

			const loading = traceInfo.loadScreenshots();
			await vi.advanceTimersByTimeAsync(10000);

			expect(await loading).toEqual(screenshots);
			expect(loadScreenshotsForTrace).not.toHaveBeenCalled();
		});

		it("doesn't download the ZIP again when the service worker fails to", async () => {
			const warn = vi
				.spyOn(console, "warn")
				.mockImplementationOnce(() => undefined);
			vi.mocked(loadScreenshotsForTrace).mockRejectedValueOnce(
				new Error("Failed to fetch ZIP"),
			);
			const traceInfo = await loadTrace();

			expect(await traceInfo.loadScreenshots()).toEqual([]);
			expect(loadScreenshotsInPage).not.toHaveBeenCalled();
			expect(warn).toHaveBeenCalledOnce();
		});
	});
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function textResponse(body: string, status: number): Response {
	return new Response(body, { status });
}

function otlpExport(
	traceId: string,
	options: { includeTestSpan?: boolean } = {},
) {
	const includeTestSpan = options.includeTestSpan ?? true;
	return {
		resourceSpans: [
			{
				resource: {
					attributes: [
						{ key: "service.name", value: { stringValue: "playwright-tests" } },
					],
				},
				scopeSpans: [
					{
						scope: { name: "playwright-opentelemetry", version: "0.0.0" },
						spans: [
							...(includeTestSpan ? [testSpan(traceId)] : []),
							span(traceId, "step000000000001", "playwright.test.step", {
								parentSpanId: "testspan0000001",
								attributes: [
									{
										key: "test.step.title",
										value: { stringValue: "click checkout" },
									},
								],
							}),
						],
					},
				],
			},
			{
				resource: {
					attributes: [
						{ key: "service.name", value: { stringValue: "backend-api" } },
					],
				},
				scopeSpans: [
					{
						scope: { name: "http", version: "1.0.0" },
						spans: [span(traceId, "backend00000001", "HTTP GET /checkout")],
					},
				],
			},
		],
	};
}

function testSpan(traceId: string) {
	return span(traceId, "testspan0000001", "playwright.test", {
		attributes: [
			{ key: "test.case.title", value: { stringValue: "checkout completes" } },
			{
				key: "playwright.test.describes",
				value: {
					arrayValue: {
						values: [
							{ stringValue: "Checkout" },
							{ stringValue: "Happy path" },
						],
					},
				},
			},
			{ key: "playwright.test.status", value: { stringValue: "passed" } },
			{
				key: "code.file.path",
				value: { stringValue: "tests/checkout.spec.ts" },
			},
			{ key: "code.line.number", value: { intValue: 42 } },
		],
	});
}

function span(
	traceId: string,
	spanId: string,
	name: string,
	options: { parentSpanId?: string; attributes?: unknown[] } = {},
) {
	return {
		traceId,
		spanId,
		parentSpanId: options.parentSpanId,
		name,
		kind: 1,
		startTimeUnixNano: "1766927492000000000",
		endTimeUnixNano: "1766927493000000000",
		attributes: options.attributes ?? [],
		droppedAttributesCount: 0,
		events: [],
		droppedEventsCount: 0,
		status: { code: 1 },
		links: [],
		droppedLinksCount: 0,
	};
}
