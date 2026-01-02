import { expect, test } from "@playwright/test";

const MOCK_API_URL = "http://localhost:9295";

test("loads trace from API and displays test info and spans", async ({
	page,
	request,
}) => {
	const traceId = `test-trace-${Date.now()}`;
	const testStartTime = Date.now();
	const testEndTime = testStartTime + 2000; // 2 second test

	const traceIdHex = "abc123def456abc123def456abc123de";

	await request.post(`${MOCK_API_URL}/${traceId}`, {
		data: {
			testInfo: {
				name: "Example login test",
				describes: ["Authentication", "Login flow"],
				file: "auth/login.spec.ts",
				line: 15,
				status: "passed",
				traceId: traceIdHex,
				startTimeUnixNano: `${testStartTime}000000`,
				endTimeUnixNano: `${testEndTime}000000`,
			},
			traces: [
				{
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
											kind: 1,
											startTimeUnixNano: `${testStartTime}000000`,
											endTimeUnixNano: `${testEndTime}000000`,
											attributes: [
												{
													key: "test.case.title",
													value: { stringValue: "Example login test" },
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
											kind: 1,
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
											kind: 1,
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
									],
								},
							],
						},
						// Browser spans (playwright-browser service)
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
										{
											traceId: traceIdHex,
											spanId: "span00000010",
											name: "HTTP GET /login",
											kind: 3, // CLIENT
											startTimeUnixNano: `${testStartTime + 150}000000`,
											endTimeUnixNano: `${testStartTime + 400}000000`,
											attributes: [],
											status: { code: 1 },
											events: [],
											links: [],
										},
										{
											traceId: traceIdHex,
											spanId: "span00000011",
											name: "HTTP POST /api/auth",
											kind: 3, // CLIENT
											startTimeUnixNano: `${testStartTime + 700}000000`,
											endTimeUnixNano: `${testStartTime + 1100}000000`,
											attributes: [],
											status: { code: 1 },
											events: [],
											links: [],
										},
									],
								},
							],
						},
						// External spans (api-service)
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
											attributes: [],
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
											attributes: [],
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
			],
			screenshots: [],
		},
	});

	await page.goto("/");

	await page.getByTestId("api-url-input").fill(`${MOCK_API_URL}/${traceId}`);
	await page.getByTestId("load-api-button").click();

	// Test name should be visible in header
	await expect(page.getByTestId("test-name")).toHaveText("Example login test");

	// Describe path should be visible
	await expect(page.getByText("Authentication")).toBeVisible();
	await expect(page.getByText("Login flow")).toBeVisible();

	// File location should be visible
	await expect(page.getByText("auth/login.spec.ts:15")).toBeVisible();

	// Status should show passed
	await expect(page.getByText("passed")).toBeVisible();

	// Step spans should be visible in Steps Timeline
	await expect(page.getByText("Navigate to login page")).toBeVisible();
	await expect(page.getByText("Fill login form")).toBeVisible();

	// Browser spans should be visible
	await expect(page.getByText("HTTP GET /login")).toBeVisible();
	await expect(page.getByText("HTTP POST /api/auth")).toBeVisible();

	// External spans should be visible (use exact match to avoid matching "HTTP POST /api/auth")
	await expect(page.getByText("POST /api/auth", { exact: true })).toBeVisible();
	await expect(page.getByText("DB query users")).toBeVisible();
});

test("can load trace via URL query parameter", async ({ page, request }) => {
	// Register a trace first
	const traceId = `url-param-trace-${Date.now()}`;
	const testStartTime = Date.now();
	const testEndTime = testStartTime + 1000;
	const traceIdHex = "def456abc123def456abc123def456ab";

	await request.post(`${MOCK_API_URL}/${traceId}`, {
		data: {
			testInfo: {
				name: "URL param test",
				describes: [],
				file: "param.spec.ts",
				line: 5,
				status: "passed",
				traceId: traceIdHex,
				startTimeUnixNano: `${testStartTime}000000`,
				endTimeUnixNano: `${testEndTime}000000`,
			},
			traces: [
				{
					resourceSpans: [
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
										{
											traceId: traceIdHex,
											spanId: "span00000001",
											name: "playwright.test",
											kind: 1,
											startTimeUnixNano: `${testStartTime}000000`,
											endTimeUnixNano: `${testEndTime}000000`,
											attributes: [
												{
													key: "test.case.title",
													value: { stringValue: "URL param test" },
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
			],
			screenshots: [],
		},
	});

	// Navigate directly with the traceSource query parameter
	const apiUrl = `${MOCK_API_URL}/${traceId}`;
	await page.goto(`/?traceSource=${encodeURIComponent(apiUrl)}`);

	// Test should load directly without needing to use the input
	await expect(page.getByTestId("test-name")).toHaveText("URL param test");
	await expect(page.getByText("param.spec.ts:5")).toBeVisible();
});
