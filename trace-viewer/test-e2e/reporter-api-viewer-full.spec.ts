import { expect, test } from "@playwright/test";

const TRACE_API_URL = "http://localhost:9295";

test.describe("reporter, trace-api, trace-viewer flow", () => {
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

		const passedLocator = page.getByText("passed");
		await expect(passedLocator).toBeVisible();
	});
});
