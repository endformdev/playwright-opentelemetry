import { defineConfig, devices } from "@playwright/test";
import type { PlaywrightOpentelemetryUseOptions } from "playwright-opentelemetry/fixture";
import {
	LIVE_TRACE_WORKER_URL,
	LIVE_VIEWER_URL,
} from "./test-e2e-live/live-session";

/**
 * Live traces end to end. Run it with `pnpm test:e2e:live`, which starts the
 * viewer and the Cloudflare Worker in test-e2e-live/live-trace-worker first
 * (see test-e2e-live/run.ts), so it stays out of the default e2e run.
 *
 * Two projects run at the same time. "live-producer" runs a test that streams
 * a live trace. "live-observer" watches that trace in the viewer and checks
 * each part arrives while the producer is paused at a checkpoint. Both are
 * traced by playwright-opentelemetry: the producer as a live trace and a ZIP,
 * the observer as a static trace on the same Worker and a ZIP.
 */
export default defineConfig<PlaywrightOpentelemetryUseOptions>({
	testDir: "./test-e2e-live",
	outputDir: "./test-results-live",
	// The producer and observer must run at the same time; one spare worker
	// keeps other observer-side tests from holding up the producer.
	workers: 3,
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	globalSetup: "./test-e2e-live/global-setup.ts",
	reporter: [
		["list"],
		["html", { open: "never", outputFolder: "playwright-report-live" }],
		["playwright-opentelemetry/reporter"],
	],
	use: {
		trace: {
			mode: "on",
			screenshots: true,
			snapshots: false,
			sources: false,
			attachments: false,
		},
	},
	projects: [
		{
			name: "live-producer",
			testMatch: /producer\.spec\.ts/,
			use: {
				...devices["Desktop Chrome"],
				playwrightOpentelemetry: {
					playwrightTraceApiEndpoint: {
						url: LIVE_TRACE_WORKER_URL,
						live: true,
					},
					storeTraceZip: true,
				},
			},
		},
		{
			name: "live-observer",
			testIgnore: /producer\.spec\.ts/,
			use: {
				...devices["Desktop Chrome"],
				baseURL: LIVE_VIEWER_URL,
				viewport: { width: 1400, height: 900 },
				playwrightOpentelemetry: {
					playwrightTraceApiEndpoint: { url: LIVE_TRACE_WORKER_URL },
					storeTraceZip: true,
				},
			},
		},
	],
});
