import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import type { PlaywrightOpentelemetryReporterOptions } from "./dist/index.mjs";

loadEnv();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
	testDir: "./test-e2e",
	/* Run tests in files in parallel */
	fullyParallel: true,
	/* Fail the build on CI if you accidentally left test.only in the source code. */
	forbidOnly: !!process.env.CI,
	/* Retry on CI only */
	retries: process.env.CI ? 2 : 0,
	/* Opt out of parallel tests on CI. */
	workers: process.env.CI ? 1 : undefined,
	/* Reporter to use. See https://playwright.dev/docs/test-reporters */
	reporter: [
		[
			"./dist/index.mjs",
			{
				tracesEndpoint:
					process.env.TRACES_ENDPOINT || "http://localhost:4317/v1/traces",
				headers: {
					Authorization: `Bearer ${process.env.TRACES_TOKEN}`,
				},
			} satisfies PlaywrightOpentelemetryReporterOptions,
		],
	],
	/* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
	use: {
		/* Base URL to use in actions like `await page.goto('')`. */
		// baseURL: 'http://localhost:3000',

		/* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
		trace: "on-first-retry",
	},

	/* Configure projects for major browsers */
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],

	/* Run your local dev server before starting the tests */
	// webServer: {
	//   command: 'npm run start',
	//   url: 'http://localhost:3000',
	//   reuseExistingServer: !process.env.CI,
	// },
});

function loadEnv() {
	const envFile = ".env";
	if (fs.existsSync(envFile)) {
		const lines = fs.readFileSync(envFile, "utf-8").split("\n");
		for (const line of lines) {
			if (!line || line.startsWith("#")) continue;
			const [key, value] = line.split("=");
			if (key && value && !process.env[key]) {
				process.env[key.trim()] = value.trim();
			}
		}
	}
}
