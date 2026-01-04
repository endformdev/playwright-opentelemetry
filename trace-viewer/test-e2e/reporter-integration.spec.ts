import { expect, test } from "@playwright/test";

const TRACE_API_URL = "http://localhost:9295";

test.describe("Reporter Integration", () => {
	test("loads and displays a real trace from reporter e2e tests", async ({
		page,
		request,
	}) => {
		// Fetch the list of available trace IDs from the trace-api-server
		const traceIdsResponse = await request.get(`${TRACE_API_URL}/trace-ids`);
		expect(traceIdsResponse.ok()).toBeTruthy();

		const { traceIds } = (await traceIdsResponse.json()) as {
			traceIds: string[];
		};

		// Verify we have at least one trace
		expect(traceIds.length).toBeGreaterThan(0);

		// Load the first trace in the viewer
		const traceId = traceIds[0];
		await page.goto("/");

		await page
			.getByTestId("api-url-input")
			.fill(`${TRACE_API_URL}/test-traces/${traceId}`);
		await page.getByTestId("load-api-button").click();

		// Wait for the trace to load
		await expect(page.getByTestId("test-name")).toBeVisible({ timeout: 10000 });

		// Verify we can see the test name (should be from reporter/test-e2e/example.spec.ts)
		const testName = await page.getByTestId("test-name").textContent();
		expect(testName).toBeTruthy();
		console.log(`Loaded trace for test: ${testName}`);

		// Verify we can see test status
		const statusElement = page.locator("[data-status]");
		await expect(statusElement).toBeVisible();

		// Verify we can see some spans (the trace should have at least the test span)
		// The test should have playwright.test spans visible
		const testSpan = page.getByText("playwright.test");
		await expect(testSpan).toBeVisible();

		// Check for test steps or other spans
		// Real reporter traces should include test steps
		const stepsPanel = page.locator('[data-testid="steps-timeline"]');
		await expect(stepsPanel).toBeVisible();
	});

	// test("can load multiple traces from reporter e2e tests", async ({
	// 	page,
	// 	request,
	// }) => {
	// 	// Fetch the list of available trace IDs
	// 	const traceIdsResponse = await request.get(`${TRACE_API_URL}/trace-ids`);
	// 	expect(traceIdsResponse.ok()).toBeTruthy();

	// 	const { traceIds } = (await traceIdsResponse.json()) as {
	// 		traceIds: string[];
	// 	};

	// 	// If we have multiple traces, verify we can load different ones
	// 	if (traceIds.length > 1) {
	// 		for (let i = 0; i < Math.min(2, traceIds.length); i++) {
	// 			const traceId = traceIds[i];

	// 			await page.goto("/");
	// 			await page
	// 				.getByTestId("api-url-input")
	// 				.fill(`${TRACE_API_URL}/test-traces/${traceId}`);
	// 			await page.getByTestId("load-api-button").click();

	// 			// Wait for the trace to load
	// 			await expect(page.getByTestId("test-name")).toBeVisible({
	// 				timeout: 10000,
	// 			});

	// 			const testName = await page.getByTestId("test-name").textContent();
	// 			console.log(`Loaded trace ${i + 1}: ${testName}`);

	// 			// Verify unique test loaded
	// 			expect(testName).toBeTruthy();
	// 		}
	// 	} else {
	// 		console.log("Only one trace available, skipping multi-trace test");
	// 	}
	// });
});
