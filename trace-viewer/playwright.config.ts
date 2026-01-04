import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./test-e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: [["html", { open: "never" }]],
	globalSetup: "./test-e2e/global-setup.ts",
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
			command: "pnpm dev",
			url: "http://localhost:9294",
		},
		{
			command: "npx tsx test-e2e/trace-api-server.ts",
			url: "http://localhost:9295/health",
		},
	],
});
