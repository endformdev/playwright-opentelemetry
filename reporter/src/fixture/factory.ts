import path from "node:path";
import type { Request, Response, test as base } from "@playwright/test";
import { BrowserPageTracker } from "./browser-page-tracker";
import { fixtureOtelHeaderPropagator } from "./network-propagator";
import { fixtureCaptureRequestResponse } from "./request-response-capture";

type TestTraceInfo = {
	testId: string;
	outputDir: string;
};

export function createPlaywrightOtelTest(testBase: typeof base): typeof base {
	return testBase.extend<{
		testTraceInfo: TestTraceInfo;
		browserPageTracker: BrowserPageTracker;
	}>({
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
		browserPageTracker: [
			async ({ testTraceInfo: { testId, outputDir } }, use) => {
				await use(new BrowserPageTracker(testId, outputDir));
			},
			{ auto: true },
		],
		context: async (
			{ context, testTraceInfo: { testId, outputDir }, browserPageTracker },
			use,
		) => {
			context.route("**", async (route, request) => {
				browserPageTracker.startDocumentNavigation(request);
				await fixtureOtelHeaderPropagator({
					route,
					request,
					testId,
					outputDir,
					parentSpanId: browserPageTracker.getActivePageSpanId(request) ?? null,
				});
			});
			await use(context);
		},
		page: async (
			{ page, testTraceInfo: { testId, outputDir }, browserPageTracker },
			use,
		) => {
			browserPageTracker.registerPage(page);
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
					testId,
					outputDir,
				});
			});

			await use(page);
		},
	});
}
