import { expect, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";

test("loads trace from API and displays test info and spans", async ({
	page,
	request,
}) => {
	const testStartTime = Date.now();
	const testEndTime = testStartTime + 2000; // 2 second test

	const traceIdHex = "abc123def456abc123def456abc123de";

	// Step 1: Send OTLP traces via POST /v1/traces
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
									kind: 1,
									startTimeUnixNano: `${testStartTime}000000`,
									endTimeUnixNano: `${testEndTime}000000`,
									attributes: [
										{
											key: "test.case.title",
											value: { stringValue: "Example login test" },
										},
										{
											key: "playwright.test.describes",
											value: {
												arrayValue: {
													values: [
														{ stringValue: "Authentication" },
														{ stringValue: "Login flow" },
													],
												},
											},
										},
										{
											key: "playwright.test.status",
											value: { stringValue: "passed" },
										},
										{
											key: "code.file.path",
											value: { stringValue: "auth/login.spec.ts" },
										},
										{
											key: "code.line.number",
											value: { intValue: 15 },
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
	});

	// Step 2: Load the trace in the viewer (note the /otel-trace-viewer prefix)
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceIdHex);

	// Test name should be visible in header
	await expect(viewer.header.testName).toHaveText("Example login test");

	// Describe path should be visible
	await expect(viewer.header.describes).toContainText("Authentication");
	await expect(viewer.header.describes).toContainText("Login flow");

	// File location should be visible
	await expect(viewer.header.fileLocation).toHaveText("auth/login.spec.ts:15");

	// Status should show passed
	await expect(viewer.header.status).toHaveText("passed");

	// Step spans should be visible in Steps Timeline
	await expect(viewer.steps.spanByName("Navigate to login page")).toBeVisible();
	await expect(viewer.steps.spanByName("Fill login form")).toBeVisible();
	expect(await viewer.steps.spanTiming("Navigate to login page")).toEqual({
		startMs: 100,
		durationMs: 400,
		endMs: 500,
	});
	expect(await viewer.steps.spanTiming("Fill login form")).toEqual({
		startMs: 600,
		durationMs: 600,
		endMs: 1200,
	});

	// Browser spans should be visible
	await expect(viewer.browserSpans.spanByName("HTTP GET /login")).toBeVisible();
	await expect(
		viewer.browserSpans.spanByName("HTTP POST /api/auth"),
	).toBeVisible();

	// External spans should be visible (use exact match to avoid matching "HTTP POST /api/auth")
	await expect(viewer.externalSpans.spanByName("POST /api/auth")).toBeVisible();
	await expect(viewer.externalSpans.spanByName("DB query users")).toBeVisible();
	expect(await viewer.externalSpans.spanTiming("POST /api/auth")).toEqual({
		startMs: 750,
		durationMs: 300,
		endMs: 1050,
	});
});

test("can load trace via URL query parameter", async ({ page, request }) => {
	// Register a trace first
	const testStartTime = Date.now();
	const testEndTime = testStartTime + 1000;
	const traceIdHex = "def456abc123def456abc123def456ab";

	// Send OTLP traces
	await request.post(`${TRACE_API_URL}/v1/traces`, {
		data: {
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
										{
											key: "playwright.test.status",
											value: { stringValue: "passed" },
										},
										{
											key: "code.file.path",
											value: { stringValue: "param.spec.ts" },
										},
										{
											key: "code.line.number",
											value: { intValue: 5 },
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

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromUrlParam(traceIdHex);

	// Test should load directly without needing to use the input
	await expect(viewer.header.testName).toHaveText("URL param test");
	await expect(viewer.header.fileLocation).toHaveText("param.spec.ts:5");
});
