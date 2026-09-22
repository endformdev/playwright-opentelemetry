// spec: tests/search/search-functionality.plan.md
// seed: tests/search/seed.spec.ts

import { expect, test, type APIRequestContext } from "@playwright/test";

const TRACE_API_URL = "http://localhost:9295";

// Helper to generate unique trace IDs
function generateTraceId(suffix: string): string {
	return `search${suffix}`.padEnd(32, "0").slice(0, 32);
}

// Shared trace data setup function
async function setupTraceData(
	request: APIRequestContext,
	traceIdHex: string,
	testStartTime: number,
) {
	const testEndTime = testStartTime + 3000; // 3 second test

	// Send OTLP traces via POST /v1/traces
	await request.post(`${TRACE_API_URL}/v1/traces`, {
		data: {
			resourceSpans: [
				// Playwright test spans
				{
					resource: {
						attributes: [
							{
								key: "service.name",
								value: { stringValue: "playwright-tests" },
							},
						],
					},
					scopeSpans: [
						{
							scope: { name: "playwright", version: "1.50.0" },
							spans: [
								// Test span (root)
								{
									traceId: traceIdHex,
									spanId: "span00000001",
									name: "playwright.test",
									kind: 1, // INTERNAL
									startTimeUnixNano: `${testStartTime}000000`,
									endTimeUnixNano: `${testEndTime}000000`,
									attributes: [
										{
											key: "test.case.title",
											value: { stringValue: "Search functionality test" },
										},
									],
									status: { code: 1 },
									events: [],
									links: [],
								},
								// Step: Navigate to login page
								{
									traceId: traceIdHex,
									spanId: "span00000002",
									parentSpanId: "span00000001",
									name: "playwright.test.step",
									kind: 1, // INTERNAL
									startTimeUnixNano: `${testStartTime + 100}000000`,
									endTimeUnixNano: `${testStartTime + 500}000000`,
									attributes: [
										{
											key: "test.step.title",
											value: { stringValue: "Navigate to login page" },
										},
									],
									status: { code: 1 },
									events: [],
									links: [],
								},
								// Step: Fill login form
								{
									traceId: traceIdHex,
									spanId: "span00000003",
									parentSpanId: "span00000001",
									name: "playwright.test.step",
									kind: 1, // INTERNAL
									startTimeUnixNano: `${testStartTime + 600}000000`,
									endTimeUnixNano: `${testStartTime + 1200}000000`,
									attributes: [
										{
											key: "test.step.title",
											value: { stringValue: "Fill login form" },
										},
									],
									status: { code: 1 },
									events: [],
									links: [],
								},
								// Step: Submit credentials
								{
									traceId: traceIdHex,
									spanId: "span00000004",
									parentSpanId: "span00000001",
									name: "playwright.test.step",
									kind: 1, // INTERNAL
									startTimeUnixNano: `${testStartTime + 1300}000000`,
									endTimeUnixNano: `${testStartTime + 1800}000000`,
									attributes: [
										{
											key: "test.step.title",
											value: { stringValue: "Submit credentials" },
										},
									],
									status: { code: 1 },
									events: [],
									links: [],
								},
							],
						},
					],
				},
				// Browser spans with HTTP requests
				{
					resource: {
						attributes: [
							{
								key: "service.name",
								value: { stringValue: "playwright-browser" },
							},
						],
					},
					scopeSpans: [
						{
							scope: { name: "playwright-browser", version: "1.0" },
							spans: [
								// HTTP GET to playwright.dev
								{
									traceId: traceIdHex,
									spanId: "span00000010",
									name: "HTTP GET",
									kind: 3, // CLIENT
									startTimeUnixNano: `${testStartTime + 150}000000`,
									endTimeUnixNano: `${testStartTime + 400}000000`,
									attributes: [
										{
											key: "http.request.method",
											value: { stringValue: "GET" },
										},
										{
											key: "server.address",
											value: { stringValue: "playwright.dev" },
										},
										{
											key: "url.full",
											value: { stringValue: "https://playwright.dev/docs" },
										},
									],
									status: { code: 1 },
									events: [],
									links: [],
								},
								// Another HTTP GET to playwright.dev
								{
									traceId: traceIdHex,
									spanId: "span00000011",
									name: "HTTP GET",
									kind: 3, // CLIENT
									startTimeUnixNano: `${testStartTime + 450}000000`,
									endTimeUnixNano: `${testStartTime + 600}000000`,
									attributes: [
										{
											key: "http.request.method",
											value: { stringValue: "GET" },
										},
										{
											key: "server.address",
											value: { stringValue: "playwright.dev" },
										},
										{
											key: "url.full",
											value: { stringValue: "https://playwright.dev/api" },
										},
									],
									status: { code: 1 },
									events: [],
									links: [],
								},
								// HTTP POST request
								{
									traceId: traceIdHex,
									spanId: "span00000012",
									name: "HTTP POST",
									kind: 3, // CLIENT
									startTimeUnixNano: `${testStartTime + 700}000000`,
									endTimeUnixNano: `${testStartTime + 1100}000000`,
									attributes: [
										{
											key: "http.request.method",
											value: { stringValue: "POST" },
										},
										{
											key: "server.address",
											value: { stringValue: "api.example.com" },
										},
										{
											key: "url.full",
											value: { stringValue: "https://api.example.com/auth" },
										},
									],
									status: { code: 1 },
									events: [],
									links: [],
								},
								// Another HTTP GET
								{
									traceId: traceIdHex,
									spanId: "span00000013",
									name: "HTTP GET",
									kind: 3, // CLIENT
									startTimeUnixNano: `${testStartTime + 1200}000000`,
									endTimeUnixNano: `${testStartTime + 1500}000000`,
									attributes: [
										{
											key: "http.request.method",
											value: { stringValue: "GET" },
										},
										{
											key: "server.address",
											value: { stringValue: "cdn.example.com" },
										},
										{
											key: "url.full",
											value: { stringValue: "https://cdn.example.com/assets" },
										},
									],
									status: { code: 1 },
									events: [],
									links: [],
								},
							],
						},
					],
				},
				// External API spans
				{
					resource: {
						attributes: [
							{
								key: "service.name",
								value: { stringValue: "api-service" },
							},
						],
					},
					scopeSpans: [
						{
							scope: { name: "api", version: "1.0" },
							spans: [
								{
									traceId: traceIdHex,
									spanId: "span00000020",
									name: "POST /api/auth",
									kind: 2, // SERVER
									startTimeUnixNano: `${testStartTime + 750}000000`,
									endTimeUnixNano: `${testStartTime + 1050}000000`,
									attributes: [
										{
											key: "http.route",
											value: { stringValue: "/api/auth" },
										},
									],
									status: { code: 1 },
									events: [],
									links: [],
								},
								{
									traceId: traceIdHex,
									spanId: "span00000021",
									name: "DB query users",
									kind: 1, // INTERNAL
									startTimeUnixNano: `${testStartTime + 800}000000`,
									endTimeUnixNano: `${testStartTime + 950}000000`,
									attributes: [
										{
											key: "db.system",
											value: { stringValue: "postgresql" },
										},
									],
									status: { code: 1 },
									events: [],
									links: [],
								},
							],
						},
					],
				},
			],
		},
	});

	// Send test.json via PUT
	await request.put(`${TRACE_API_URL}/otel-playwright-reporter/test.json`, {
		headers: {
			"X-Trace-Id": traceIdHex,
		},
		data: {
			name: "Search functionality test",
			describes: ["Search", "Basic Search"],
			file: "search/basic-search.spec.ts",
			line: 10,
			status: "passed",
			traceId: traceIdHex,
			startTimeUnixNano: `${testStartTime}000000`,
			endTimeUnixNano: `${testEndTime}000000`,
		},
	});
}

// Helper to load trace in the viewer
async function loadTrace(
	page: import("@playwright/test").Page,
	traceIdHex: string,
) {
	await page.goto("/");
	await page
		.getByTestId("api-url-input")
		.fill(`${TRACE_API_URL}/otel-trace-viewer/${traceIdHex}`);
	await page.getByTestId("load-api-button").click();

	// Wait for trace to load
	await expect(page.getByTestId("test-name")).toBeVisible();
}

test.describe("Basic Search Functionality", () => {
	test.describe.configure({ mode: "serial" });

	// Use a shared trace ID for all tests in this suite to avoid setup overhead
	const traceIdHex = generateTraceId("basicsearch1");
	let testStartTime: number;

	test.beforeAll(async ({ request }) => {
		testStartTime = Date.now();
		await setupTraceData(request, traceIdHex, testStartTime);
	});

	test("1.1. should focus search input when clicking on search box", async ({
		page,
	}) => {
		// 1. Load a trace with spans and external requests
		await loadTrace(page, traceIdHex);

		// Verify search combobox is visible in the header
		const searchInput = page.getByPlaceholder("Search spans...");
		await expect(searchInput).toBeVisible();

		// Verify keyboard shortcut hint (/) is visible when not focused
		const keyboardHint = page.locator("kbd").filter({ hasText: "/" });
		await expect(keyboardHint).toBeVisible();

		// 2. Click on the search combobox
		await searchInput.click();

		// 3. Verify the search input is focused
		await expect(searchInput).toBeFocused();

		// Verify keyboard shortcut hint (/) is hidden when focused
		await expect(keyboardHint).not.toBeVisible();
	});

	test("1.2. should focus search input when pressing / key", async ({
		page,
	}) => {
		// 1. Load a trace with spans
		await loadTrace(page, traceIdHex);

		const searchInput = page.getByPlaceholder("Search spans...");

		// Verify search combobox shows / keyboard hint when not focused
		const keyboardHint = page.locator("kbd").filter({ hasText: "/" });
		await expect(keyboardHint).toBeVisible();

		// 2. Click somewhere on the page to ensure search is not focused
		await page.getByTestId("test-name").click();
		await expect(searchInput).not.toBeFocused();

		// 3. Press the / key
		await page.keyboard.press("/");

		// 4. Verify the search input is focused
		await expect(searchInput).toBeFocused();

		// The / character should NOT be typed into the input
		await expect(searchInput).toHaveValue("");
	});

	test("1.3. should display search results when typing a query", async ({
		page,
	}) => {
		// 1. Load a trace with HTTP GET spans
		await loadTrace(page, traceIdHex);

		const searchInput = page.getByPlaceholder("Search spans...");

		// 2. Click on the search combobox
		await searchInput.click();

		// 3. Type 'GET' into the search input
		await searchInput.fill("GET");

		// 4. Wait for search results to appear (200ms debounce + rendering)
		await page.waitForTimeout(300);

		// Verify search results dropdown opens after typing
		const dropdown = page.locator(
			'[data-scope="combobox"][data-part="content"]',
		);
		await expect(dropdown).toBeVisible();

		// Results show spans matching 'GET'
		// Each result displays the matched text and parent span title
		const resultItems = page.locator(
			'[data-scope="combobox"][data-part="item"]',
		);
		await expect(resultItems.first()).toBeVisible();

		// Verify results contain GET-related content
		await expect(dropdown).toContainText("GET");
	});

	test("1.4. should show 'No results found' for queries with no matches", async ({
		page,
	}) => {
		// 1. Load a trace with spans
		await loadTrace(page, traceIdHex);

		const searchInput = page.getByPlaceholder("Search spans...");

		// 2. Click on the search combobox
		await searchInput.click();

		// 3. Type a non-existent query
		await searchInput.fill("zzzznonexistent");

		// 4. Wait for search to execute (200ms debounce)
		await page.waitForTimeout(300);

		// Verify dropdown shows 'No results found' message
		const dropdown = page.locator(
			'[data-scope="combobox"][data-part="content"]',
		);
		await expect(dropdown).toBeVisible();
		await expect(dropdown).toContainText("No results found");

		// No span results are displayed
		const resultItems = page.locator(
			'[data-scope="combobox"][data-part="item"]',
		);
		await expect(resultItems).toHaveCount(0);
	});

	test("1.5. should clear search when clicking the clear button", async ({
		page,
	}) => {
		// 1. Load a trace with spans
		await loadTrace(page, traceIdHex);

		const searchInput = page.getByPlaceholder("Search spans...");

		// 2. Type a search query
		await searchInput.click();
		await searchInput.fill("GET");

		// Wait for results to appear
		await page.waitForTimeout(300);
		const dropdown = page.locator(
			'[data-scope="combobox"][data-part="content"]',
		);
		await expect(dropdown).toBeVisible();

		// Verify clear button appears when there is search text
		const clearButton = page.getByTestId("search-clear-button");
		await expect(clearButton).toBeVisible();

		// 3. Click the clear (X) button
		await clearButton.click();

		// 4. Verify search is cleared
		// Clicking clear button empties the search input
		await expect(searchInput).toHaveValue("");

		// Search results dropdown closes
		await expect(dropdown).not.toBeVisible();
	});

	test("1.6. should close search dropdown when pressing Escape", async ({
		page,
	}) => {
		// 1. Load a trace with spans
		await loadTrace(page, traceIdHex);

		const searchInput = page.getByPlaceholder("Search spans...");

		// 2. Type a search query to open results dropdown
		await searchInput.click();
		await searchInput.fill("GET");

		// Wait for results dropdown to appear
		await page.waitForTimeout(300);
		const dropdown = page.locator(
			'[data-scope="combobox"][data-part="content"]',
		);
		await expect(dropdown).toBeVisible();

		// 3. Press the Escape key
		await page.keyboard.press("Escape");

		// 4. Verify dropdown closes
		await expect(dropdown).not.toBeVisible();

		// Search text remains in the input
		await expect(searchInput).toHaveValue("GET");
	});

	test("1.7. should highlight matched text in search results", async ({
		page,
	}) => {
		// 1. Load a trace with spans
		await loadTrace(page, traceIdHex);

		const searchInput = page.getByPlaceholder("Search spans...");

		// 2. Type a specific search query
		await searchInput.click();
		await searchInput.fill("playwright.dev");

		// 3. Wait for search results
		await page.waitForTimeout(300);

		const dropdown = page.locator(
			'[data-scope="combobox"][data-part="content"]',
		);
		await expect(dropdown).toBeVisible();

		// Verify matched portions of text are highlighted with yellow background
		// The highlighting uses class "bg-yellow-200 font-semibold"
		const highlightedText = dropdown.locator(".bg-yellow-200.font-semibold");
		await expect(highlightedText.first()).toBeVisible();

		// Verify the highlighted text contains part of the search query
		const highlightedContent = await highlightedText.first().textContent();
		expect(highlightedContent?.toLowerCase()).toContain("playwright");
	});
});
