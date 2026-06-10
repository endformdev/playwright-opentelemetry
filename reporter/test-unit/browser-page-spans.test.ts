import type {
	ConsoleMessage,
	Page,
	Request,
	Response,
	Route,
} from "@playwright/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	BrowserPageTracker,
	shouldCreateSameDocumentPageSpan,
} from "../src/fixture/browser-page-tracker";
import { fixtureOtelHeaderPropagator } from "../src/fixture/network-propagator";
import { fixtureCaptureRequestResponse } from "../src/fixture/request-response-capture";
import {
	FIXTURE_SPANS_ATTACHMENT_NAME,
	flushFixtureSpans,
	type TestTraceContext,
} from "../src/fixture/trace-context";
import { resolvePlaywrightOpentelemetryConfig } from "../src/shared/config";
import { generateSpanId, generateTraceId } from "../src/shared/otel";

describe("fixture browser span hierarchy", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.PLAYWRIGHT_TRACE_API_ENDPOINT;
		delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
	});

	it("parents document page spans to the root test span", () => {
		const traceContext = createTraceContext();
		const tracker = new BrowserPageTracker(traceContext);
		const page = createPage("about:blank");
		tracker.registerPage(page);

		tracker.startDocumentNavigation(
			createRequest({
				page,
				url: "https://example.com/products",
				isNavigationRequest: true,
			}),
		);

		expect(traceContext.spans).toEqual([
			expect.objectContaining({
				name: "browser.page",
				parentSpanId: traceContext.rootSpanId,
				attributes: expect.objectContaining({
					"browser.resource.type": "page",
					"browser.page.navigation.type": "document",
					"browser.page.id": "page-1",
					"url.full": "https://example.com/products",
				}),
			}),
		]);
	});

	it("creates same-document route spans under the active page span", () => {
		const traceContext = createTraceContext();
		const tracker = new BrowserPageTracker(traceContext);
		const page = createPage("about:blank");
		tracker.registerPage(page);
		tracker.startDocumentNavigation(
			createRequest({
				page,
				url: "https://example.com/products",
				isNavigationRequest: true,
			}),
		);
		const pageSpan = traceContext.spans[0];

		tracker.handleFrameNavigated(page, "https://example.com/products/123");

		expect(traceContext.spans[1]).toEqual(
			expect.objectContaining({
				name: "browser.route",
				parentSpanId: pageSpan?.spanId,
				attributes: expect.objectContaining({
					"browser.resource.type": "route",
					"browser.page.navigation.type": "same-document",
					"browser.page.id": "page-1",
					"browser.document.url": "https://example.com/products",
					"browser.route.previous_url": "https://example.com/products",
					"url.full": "https://example.com/products/123",
				}),
			}),
		);
	});

	it("parents network spans to active route, active page, or root", async () => {
		const traceContext = createTraceContext();
		const tracker = new BrowserPageTracker(traceContext);
		const page = createPage("about:blank");
		tracker.registerPage(page);
		tracker.startDocumentNavigation(
			createRequest({
				page,
				url: "https://example.com/products",
				isNavigationRequest: true,
			}),
		);

		await captureNetworkRequest(
			traceContext,
			tracker,
			page,
			"active-page.json",
		);
		tracker.handleFrameNavigated(page, "https://example.com/products/123");
		await captureNetworkRequest(
			traceContext,
			tracker,
			page,
			"active-route.json",
		);
		await captureNetworkRequest(traceContext, tracker, undefined, "root.json");

		const httpSpans = traceContext.spans.filter(
			(span) => span.name === "HTTP GET",
		);
		expect(httpSpans.map((span) => span.attributes)).toEqual([
			expect.objectContaining({
				"browser.request.route_association": "active-page",
			}),
			expect.objectContaining({
				"browser.request.route_association": "active-route",
			}),
			expect.objectContaining({
				"browser.request.route_association": "root",
			}),
		]);
		expect(httpSpans[0]?.parentSpanId).toBe(traceContext.spans[0]?.spanId);
		expect(httpSpans[1]?.parentSpanId).toBe(traceContext.spans[2]?.spanId);
		expect(httpSpans[2]?.parentSpanId).toBe(traceContext.rootSpanId);
	});

	it("records console messages as log events on the active browser span", () => {
		const traceContext = createTraceContext();
		const tracker = new BrowserPageTracker(traceContext);
		const page = createPage("about:blank");
		tracker.registerPage(page);
		tracker.startDocumentNavigation(
			createRequest({
				page,
				url: "https://example.com/products",
				isNavigationRequest: true,
			}),
		);

		tracker.recordConsoleMessage(
			page,
			createConsoleMessage({
				type: "warning",
				text: "Slow checkout render",
				url: "https://example.com/app.js",
				line: 12,
			}),
			new Date("2025-11-06T10:00:00.050Z"),
		);

		expect(traceContext.spans[0]?.events).toEqual([
			expect.objectContaining({
				name: "log",
				time: new Date("2025-11-06T10:00:00.050Z"),
				attributes: expect.objectContaining({
					message: "Slow checkout render",
					"browser.console.type": "warning",
					"severity.text": "WARN",
					"code.file.path": "https://example.com/app.js",
					"code.line.number": 13,
				}),
			}),
		]);
	});

	it("records page errors as exception events on the active route span", () => {
		const traceContext = createTraceContext();
		const tracker = new BrowserPageTracker(traceContext);
		const page = createPage("about:blank");
		tracker.registerPage(page);
		tracker.startDocumentNavigation(
			createRequest({
				page,
				url: "https://example.com/products",
				isNavigationRequest: true,
			}),
		);
		tracker.handleFrameNavigated(page, "https://example.com/products/123");
		const error = new TypeError("Cannot read properties of undefined");
		error.stack =
			"TypeError: Cannot read properties of undefined\n    at app.js:1:2";

		tracker.recordPageError(page, error, new Date("2025-11-06T10:00:00.075Z"));

		expect(traceContext.spans[1]?.events).toEqual([
			expect.objectContaining({
				name: "exception",
				time: new Date("2025-11-06T10:00:00.075Z"),
				attributes: expect.objectContaining({
					"exception.type": "TypeError",
					"exception.message": "Cannot read properties of undefined",
					"exception.stacktrace": error.stack,
				}),
			}),
		]);
		expect(traceContext.spans[1]?.status).toEqual({ code: 0 });
	});

	it("flushes fixture spans directly to the trace API", async () => {
		process.env.PLAYWRIGHT_TRACE_API_ENDPOINT = "https://traces.example.com";
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
		global.fetch = fetchMock;
		const traceContext = createTraceContext();
		traceContext.addSpan({
			traceId: traceContext.traceId,
			spanId: generateSpanId(),
			parentSpanId: traceContext.rootSpanId,
			name: "browser.page",
			startTime: new Date("2025-11-06T10:00:00.000Z"),
			endTime: new Date("2025-11-06T10:00:01.000Z"),
			attributes: { "browser.resource.type": "page" },
			events: [],
			status: { code: 0 },
			serviceName: "playwright-browser",
		});

		await flushFixtureSpans(
			traceContext,
			resolvePlaywrightOpentelemetryConfig({
				playwrightTraceApiEndpoint: "https://traces.example.com",
			}),
		);

		expect(fetchMock).toHaveBeenCalledWith(
			"https://traces.example.com/v1/traces",
			expect.objectContaining({ method: "POST" }),
		);
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.resourceSpans[0].scopeSpans[0].spans[0]).toEqual(
			expect.objectContaining({
				traceId: traceContext.traceId,
				name: "browser.page",
			}),
		);
	});

	it("attaches fixture spans when trace ZIP storage is enabled", async () => {
		const traceContext = createTraceContext();
		const spanStartTime = new Date("2025-11-06T10:00:00.000Z");
		traceContext.addSpan({
			traceId: traceContext.traceId,
			spanId: generateSpanId(),
			parentSpanId: traceContext.rootSpanId,
			name: "browser.page",
			startTime: spanStartTime,
			endTime: new Date("2025-11-06T10:00:01.000Z"),
			attributes: { "browser.resource.type": "page" },
			events: [],
			status: { code: 0 },
			serviceName: "playwright-browser",
		});
		const attach = vi.fn();

		await flushFixtureSpans(
			traceContext,
			resolvePlaywrightOpentelemetryConfig({ storeTraceZip: true }),
			{ attach },
		);

		expect(attach).toHaveBeenCalledWith(FIXTURE_SPANS_ATTACHMENT_NAME, {
			body: expect.any(String),
			contentType: "application/json",
		});
		const body = JSON.parse(attach.mock.calls[0][1].body);
		expect(body.spans).toEqual([
			expect.objectContaining({
				traceId: traceContext.traceId,
				name: "browser.page",
				startTime: spanStartTime.toISOString(),
				events: [],
				serviceName: "playwright-browser",
			}),
		]);
	});

	it("does not create a same-document route for hash-only scroll updates", () => {
		expect(
			shouldCreateSameDocumentPageSpan(
				"https://example.com/docs#getting-started",
				"https://example.com/docs#api",
				"https://example.com/docs#getting-started",
			),
		).toBe(false);
	});
});

async function captureNetworkRequest(
	traceContext: TestTraceContext,
	tracker: BrowserPageTracker,
	page: Page | undefined,
	path: string,
): Promise<void> {
	const request = createRequest({
		page,
		url: `https://example.com/${path}`,
		isNavigationRequest: false,
	});
	const route = createRoute(request);
	const response = createResponse(request);
	const parent = tracker.getNetworkParent(request);

	await fixtureOtelHeaderPropagator({
		route,
		request,
		traceContext,
		parentSpanId: parent.spanId,
		routeAssociation: parent.routeAssociation,
	});
	await fixtureCaptureRequestResponse({ request, response, traceContext });
}

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

function createPage(initialUrl: string): Page {
	const frame = {};
	const page = {
		url: () => initialUrl,
		mainFrame: () => frame,
	} as Page;
	(frame as { page: () => Page }).page = () => page;
	return page;
}

function createRequest(options: {
	page?: Page;
	url: string;
	isNavigationRequest: boolean;
}): Request {
	return {
		url: () => options.url,
		method: () => "GET",
		headers: () => ({}),
		isNavigationRequest: () => options.isNavigationRequest,
		frame: () => {
			if (!options.page) {
				throw new Error("No frame");
			}
			return options.page.mainFrame();
		},
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

function createRoute(request: Request): Route {
	return {
		fallback: async () => {},
		request: () => request,
	} as unknown as Route;
}

function createResponse(request: Request): Response {
	return {
		status: () => 200,
		request: () => request,
		headerValue: async () => "application/json",
	} as unknown as Response;
}

function createConsoleMessage(options: {
	type: string;
	text: string;
	url?: string;
	line?: number;
}): ConsoleMessage {
	return {
		type: () => options.type,
		text: () => options.text,
		location: () => ({
			url: options.url ?? "",
			line: options.line ?? 0,
			column: 0,
			lineNumber: options.line ?? 0,
			columnNumber: 0,
		}),
	} as unknown as ConsoleMessage;
}
