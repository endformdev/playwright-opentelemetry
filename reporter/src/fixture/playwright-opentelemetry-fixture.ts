import path from "node:path";
import type { Request, Response, test as base } from "@playwright/test";
import {
	resolvePlaywrightOpentelemetryConfig,
	type PlaywrightOpentelemetryUseOptions,
} from "../shared/config";
import { BrowserPageTracker } from "./browser-page-tracker";
import {
	propagateRouteTraceHeaders,
	storeRequestTraceContext,
} from "./network-propagator";
import { createCapturedApiRequestContext } from "./api-request-capture";
import {
	hasPlaywrightOpentelemetryReporter,
	MISSING_PLAYWRIGHT_OPENTELEMETRY_REPORTER_ERROR,
} from "./reporter-config";
import { fixtureCaptureRequestResponse } from "./request-response-capture";
import { runWithTestFetchCapture } from "./test-fetch-capture";
import {
	createTestTraceContext,
	flushFixtureSpans,
	registerExpectedTrace,
	type TestTraceContext,
} from "./trace-context";

type TestTraceInfo = {
	testId: string;
	outputDir: string;
};

type PlaywrightOpentelemetryFixtures = {
	testTraceInfo: TestTraceInfo;
	testTraceContext: TestTraceContext;
	browserPageTracker: BrowserPageTracker;
};

type PlaywrightOpentelemetryWorkerFixtures = {
	_playwrightOpentelemetryReporterCheck: void;
};

export function createPlaywrightOtelTest<T extends typeof base>(testBase: T) {
	return testBase.extend<
		PlaywrightOpentelemetryUseOptions & PlaywrightOpentelemetryFixtures,
		PlaywrightOpentelemetryWorkerFixtures
	>({
		playwrightOpentelemetry: [undefined, { option: true }],
		_playwrightOpentelemetryReporterCheck: [
			async ({}, use, workerInfo) => {
				if (!hasPlaywrightOpentelemetryReporter(workerInfo.config.reporter)) {
					throw new Error(MISSING_PLAYWRIGHT_OPENTELEMETRY_REPORTER_ERROR);
				}

				await use();
			},
			{ scope: "worker", auto: true },
		],
		testTraceInfo: [
			// oxlint-disable-next-line no-unused-vars -- Playwright fails if the fixture dependency is omitted
			async ({ playwright }, use, testInfo) => {
				// Use the "global" / project output dir, not the test specific output dir
				const outputDir = path.dirname(testInfo.outputDir);
				await use({
					testId: testInfo.testId,
					outputDir,
				});
			},
			{ auto: true },
		],
		testTraceContext: [
			async ({ playwrightOpentelemetry, trace }, use, testInfo) => {
				const config = resolvePlaywrightOpentelemetryConfig(
					playwrightOpentelemetry,
				);
				const traceContext = await createTestTraceContext(testInfo);
				await registerExpectedTrace(traceContext, config, {
					trace,
					testInfo,
				});
				await runWithTestFetchCapture(traceContext, () => use(traceContext));
				await flushFixtureSpans(traceContext, config, {
					trace,
					testInfo,
				});
			},
			{ auto: true },
		],
		browserPageTracker: [
			async ({ testTraceContext }, use) => {
				const tracker = new BrowserPageTracker(testTraceContext);
				await use(tracker);
				tracker.finishAll();
			},
			{ auto: true },
		],
		request: async ({ request, testTraceContext }, use) => {
			await use(createCapturedApiRequestContext(request, testTraceContext));
		},
		context: async (
			{
				context,
				playwrightOpentelemetry,
				testTraceContext,
				browserPageTracker,
			},
			use,
		) => {
			const config = resolvePlaywrightOpentelemetryConfig(
				playwrightOpentelemetry,
			);
			const captureRequest = (request: Request) => {
				browserPageTracker.startDocumentNavigation(request);
				const networkParent = browserPageTracker.getNetworkParent(request);
				storeRequestTraceContext({
					request,
					traceContext: testTraceContext,
					parentSpanId: networkParent.spanId,
					routeAssociation: networkParent.routeAssociation,
				});
			};

			context.on("request", captureRequest);
			await context.route("**", async (route, request) => {
				const requestContext = testTraceContext.requestContexts.get(request);

				if (config.propagateTraceHeaders && requestContext) {
					await propagateRouteTraceHeaders({
						route,
						request,
						traceId: testTraceContext.traceId,
						spanId: requestContext.spanId,
					});
					return;
				}

				await route.fallback();
			});

			try {
				await use(context);
			} finally {
				context.off("request", captureRequest);
			}
		},
		page: async ({ page, testTraceContext, browserPageTracker }, use) => {
			browserPageTracker.registerPage(page);
			page.on("close", () => browserPageTracker.unregisterPage(page));
			page.on("console", (message) => {
				browserPageTracker.recordConsoleMessage(page, message);
			});
			page.on("pageerror", (error) => {
				browserPageTracker.recordPageError(page, error);
			});
			page.on("framenavigated", (frame) => {
				if (frame === page.mainFrame()) {
					browserPageTracker.handleFrameNavigated(page, frame.url());
				}
			});

			// Keep the response until the request ends so capture has its final timing.
			const pendingRequests = new Map<Request, Response>();

			page.on("response", (response) => {
				pendingRequests.set(response.request(), response);
			});

			const captureCompletedRequest = async (request: Request) => {
				const response = pendingRequests.get(request);
				pendingRequests.delete(request);

				if (!response) {
					return;
				}

				await fixtureCaptureRequestResponse({
					request,
					response,
					traceContext: testTraceContext,
				});
			};

			page.on("requestfinished", captureCompletedRequest);
			// Browsers can reject a script after receiving an HTTP error response.
			page.on("requestfailed", captureCompletedRequest);

			await use(page);
		},
	});
}
