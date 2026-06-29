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
import {
	hasPlaywrightOpentelemetryReporter,
	MISSING_PLAYWRIGHT_OPENTELEMETRY_REPORTER_ERROR,
} from "./reporter-config";
import { fixtureCaptureRequestResponse } from "./request-response-capture";
import { runWithTestFetchCapture } from "./test-fetch-capture";
import {
	createTestTraceContext,
	flushFixtureSpans,
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
			// biome-ignore lint/correctness/noUnusedFunctionParameters: playwright fails if object not used
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
				await runWithTestFetchCapture(traceContext, () => use(traceContext));
				await flushFixtureSpans(traceContext, config, {
					trace: config.trace ?? trace,
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
			context.route("**", async (route, request) => {
				browserPageTracker.startDocumentNavigation(request);
				const networkParent = browserPageTracker.getNetworkParent(request);
				const spanId = storeRequestTraceContext({
					request,
					traceContext: testTraceContext,
					parentSpanId: networkParent.spanId,
					routeAssociation: networkParent.routeAssociation,
				});

				if (config.propagateTraceHeaders) {
					await propagateRouteTraceHeaders({
						route,
						request,
						traceId: testTraceContext.traceId,
						spanId,
					});
					return;
				}

				await route.fallback();
			});
			await use(context);
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

			// Two-phase capture approach:
			// 1. On 'response': Store the Response object (available synchronously)
			// 2. On 'requestfinished': Use stored response + accurate timing
			//
			// This solves two problems:
			// - 'response' event has timing.responseEnd = -1 (body not downloaded yet)
			// - 'requestfinished' requires async request.response() which may fail if page closes
			const pendingRequests = new Map<Request, Response>();

			page.on("response", (response) => {
				// Store response synchronously - no await needed
				pendingRequests.set(response.request(), response);
			});

			page.on("requestfinished", async (request) => {
				// Get the stored response - no async request.response() call needed
				const response = pendingRequests.get(request);
				pendingRequests.delete(request);

				if (!response) {
					// No response stored - request may have failed or been handled differently
					return;
				}

				// Now we have both:
				// - The Response object (captured at 'response' event)
				// - Accurate timing with responseEnd (available at 'requestfinished')
				await fixtureCaptureRequestResponse({
					request,
					response,
					traceContext: testTraceContext,
				});
			});

			await use(page);
		},
	});
}
