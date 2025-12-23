import path from "node:path";
import { test as base } from "@playwright/test";
import { writePageTestMapping } from "../shared/trace-files";
import { fixtureOtelHeaderPropagator } from "./network-propagator";
import { fixtureCaptureRequestResponse } from "./request-response-capture";

type TestTraceInfo = {
	testId: string;
	outputDir: string;
};

export const test = base.extend<{
	testTraceInfo: TestTraceInfo;
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
	context: async ({ context, testTraceInfo: { testId, outputDir } }, use) => {
		context.route(
			"**",
			async (route, request) =>
				await fixtureOtelHeaderPropagator({
					route,
					request,
					testId,
					outputDir,
				}),
		);
		await use(context);
	},
	page: async ({ page, testTraceInfo: { testId, outputDir } }, use) => {
		// Access internal _guid property used for page identification
		const pageGuid = (page as unknown as { _guid: string })._guid;
		writePageTestMapping(outputDir, testId, pageGuid);
		page.on("requestfinished", async (request) => {
			const response = await request.response();
			if (!response) {
				return;
			}
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
