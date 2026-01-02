import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./test-e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: "html",
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
			reuseExistingServer: !process.env.CI,
		},
		{
			command: "npx tsx test-e2e/mock-api-server.ts",
			url: "http://localhost:9295/health",
			reuseExistingServer: !process.env.CI,
		},
	],
});
