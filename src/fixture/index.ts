import { test as base } from "@playwright/test";
import { playwrightFixturePropagator } from "./network-propagator";

type TestTraceInfo = {
	testId: string;
	outputDir: string;
};

export const test = base.extend<{
	testTraceInfo: TestTraceInfo;
}>({
	testTraceInfo: [
		async (_, use, testInfo) => {
			await use({
				testId: testInfo.testId,
				outputDir: testInfo.outputDir,
			});
		},
		{ auto: true },
	],
	context: async ({ context, testTraceInfo: { testId, outputDir } }, use) => {
		context.route(
			"**",
			async (route) =>
				await playwrightFixturePropagator({ route, testId, outputDir }),
		);
		await use(context);
	},
});
