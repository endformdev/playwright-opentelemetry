import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./test-e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: [["html", { open: "never" }]],
	globalSetup: "./test-e2e/setup/global-setup.ts",
	use: {
		baseURL: "http://localhost:9294",
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: [
		{
			command: "pnpm build && pnpm preview --host localhost --port 9294",
			url: "http://localhost:9294",
		},
		{
			// Serves the build above the way Cloudflare does. `vite preview` ignores
			// public/_headers, so tests of those headers need this server.
			command:
				"pnpm exec wrangler dev --port 9296 --ip localhost --show-interactive-dev-session=false",
			url: "http://localhost:9296",
			env: { WRANGLER_SEND_METRICS: "false" },
		},
		{
			command:
				"pnpm --filter @playwright-opentelemetry/trace-api build && pnpm exec tsx test-e2e/trace-api-server.ts",
			url: "http://localhost:9295/health",
		},
	],
});
