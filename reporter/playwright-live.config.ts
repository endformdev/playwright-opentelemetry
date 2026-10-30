import { defineConfig, devices } from "@playwright/test";
import type { PlaywrightOpentelemetryUseOptions } from "./src/fixture";

const liveTraceApiEndpoint = process.env.LIVE_TRACE_API_ENDPOINT;
if (!liveTraceApiEndpoint) {
	throw new Error("LIVE_TRACE_API_ENDPOINT is required");
}

/**
 * Runs a slow test that streams a live trace. The trace viewer's live e2e
 * test starts this run and watches it while it runs.
 */
export default defineConfig<PlaywrightOpentelemetryUseOptions>({
	testDir: "./test-e2e-live",
	workers: 1,
	reporter: [["./dist/reporter.mjs"]],
	use: {
		playwrightOpentelemetry: {
			playwrightTraceApiEndpoint: { url: liveTraceApiEndpoint, live: true },
		},
		// Live screenshots don't depend on Playwright tracing.
		trace: "off",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
