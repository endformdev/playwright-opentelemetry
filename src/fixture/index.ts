import { test as base } from "@playwright/test";

type TestTraceInfo = {
	workerIndex: number;
	outputDir: string;
};

export const test = base.extend<{
	testTraceInfo: TestTraceInfo;
}>({
	testTraceInfo: [
		async ({ playwright }, use, testInfo) => {
			await use({
				workerIndex: testInfo.workerIndex,
				outputDir: testInfo.outputDir,
			});
		},
		{ auto: true },
	],
	context: async ({ context, testTraceInfo }, use) => {
		context.route("**", (route) => {
			console.log(
				`Route: ${route.request().url()} (worker ${testTraceInfo.workerIndex})`,
			);
			return route.continue();
		});
		await use(context);
	},
});
