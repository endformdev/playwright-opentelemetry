import path from "node:path";
import type { Page, Request, Response, test as base } from "@playwright/test";
import {
	resolvePlaywrightOpentelemetryConfig,
	type PlaywrightOpentelemetryUseOptions,
} from "../shared/config";
import { BrowserPageTracker } from "./browser-page-tracker";
import { fixtureOtelHeaderPropagator } from "./network-propagator";
import {
	hasPlaywrightOpentelemetryReporter,
	MISSING_PLAYWRIGHT_OPENTELEMETRY_REPORTER_ERROR,
} from "./reporter-config";
import { fixtureCaptureRequestResponse } from "./request-response-capture";
import { installRrwebRecorder } from "./rrweb-recorder";
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
			async ({ playwrightOpentelemetry }, use, testInfo) => {
				const config = resolvePlaywrightOpentelemetryConfig(
					playwrightOpentelemetry,
				);
				const traceContext = await createTestTraceContext(testInfo);
				await use(traceContext);
				await flushFixtureSpans(traceContext, config, testInfo);
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
				testTraceContext,
				browserPageTracker,
				playwrightOpentelemetry,
			},
			use,
			testInfo,
		) => {
			const config = resolvePlaywrightOpentelemetryConfig(
				playwrightOpentelemetry,
			);
			const instrumentedPages = new WeakSet<Page>();
			const instrumentPage = (page: Page) => {
				if (instrumentedPages.has(page)) return;
				instrumentedPages.add(page);
				instrumentBrowserPage(page, testTraceContext, browserPageTracker);
			};

			for (const page of context.pages()) {
				instrumentPage(page);
			}
			context.on("page", instrumentPage);

			const flushRrweb = config.rrweb
				? await installRrwebRecorder({
						context,
						browserPageTracker,
						testInfo,
					})
				: undefined;

			context.route("**", async (route, request) => {
				browserPageTracker.startDocumentNavigation(request);
				const networkParent = browserPageTracker.getNetworkParent(request);
				await fixtureOtelHeaderPropagator({
					route,
					request,
					traceContext: testTraceContext,
					parentSpanId: networkParent.spanId,
					routeAssociation: networkParent.routeAssociation,
				});
			});
			await use(context);
			context.off("page", instrumentPage);
			await flushRrweb?.();
		},
		page: async ({ page }, use) => {
			await use(page);
		},
	});
}

function instrumentBrowserPage(
	page: Page,
	testTraceContext: TestTraceContext,
	browserPageTracker: BrowserPageTracker,
): void {
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

	const pendingRequests = new Map<Request, Response>();

	page.on("response", (response) => {
		pendingRequests.set(response.request(), response);
	});

	page.on("requestfinished", async (request) => {
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
	});
}
