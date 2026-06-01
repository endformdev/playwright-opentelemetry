import { describe, expect, it } from "vitest";
import {
	createOtlpPayload,
	createScreenshotBuffer,
	createTestHarness,
	generateTraceId,
} from "./testHarness";

/**
 * Playwright Reporter Integration Tests
 *
 * Mimics what the @playwright-opentelemetry/reporter package does when sending trace data.
 */
describe("Playwright Reporter", () => {
	it("reports a passing test with screenshots", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// Step 1: Send OTLP spans
		const otlpPayload = createOtlpPayload({
			traceId,
			serviceName: "playwright",
			spans: [
				{
					name: "playwright.test",
					startTimeUnixNano: "1766927492000000000",
					endTimeUnixNano: "1766927493000000000",
					attributes: [
						{
							key: "test.case.title",
							value: { stringValue: "should complete successfully" },
						},
						{
							key: "test.case.result.status",
							value: { stringValue: "pass" },
						},
						{
							key: "playwright.test.status",
							value: { stringValue: "passed" },
						},
					],
				},
				{
					name: "page.goto",
					startTimeUnixNano: "1766927492100000000",
					endTimeUnixNano: "1766927492500000000",
				},
				{
					name: "page.click",
					startTimeUnixNano: "1766927492600000000",
					endTimeUnixNano: "1766927492800000000",
				},
			],
		});

		const otlpResponse = await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(otlpPayload),
			}),
		);
		expect(otlpResponse.status).toBe(200);

		// Step 2: Send screenshots
		const screenshots = [
			{
				filename: "page@123-1766927492200000000.jpeg",
				data: createScreenshotBuffer("screenshot1"),
			},
			{
				filename: "page@123-1766927492700000000.jpeg",
				data: createScreenshotBuffer("screenshot2"),
			},
		];

		for (const screenshot of screenshots) {
			const screenshotResponse = await app.fetch(
				new Request(
					`http://localhost/otel-playwright-reporter/screenshots/${screenshot.filename}`,
					{
						method: "PUT",
						headers: {
							"Content-Type": "image/jpeg",
							"X-Trace-Id": traceId,
						},
						body: screenshot.data,
					},
				),
			);
			expect(screenshotResponse.status).toBe(200);
		}

		// Verification: Read back complete trace
		// 1. List and get OTLP files
		const listOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol`,
			),
		);
		expect(listOtlpResponse.status).toBe(200);
		const otlpFiles = (await listOtlpResponse.json()) as {
			jsonFiles: string[];
		};
		expect(otlpFiles.jsonFiles).toHaveLength(1);

		const getOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol/${otlpFiles.jsonFiles[0]}`,
			),
		);
		expect(getOtlpResponse.status).toBe(200);
		const retrievedOtlp = await getOtlpResponse.json();
		expect(retrievedOtlp).toEqual(otlpPayload);
		expect(retrievedOtlp.resourceSpans[0].scopeSpans[0].spans[0]).toMatchObject(
			{
				name: "playwright.test",
				startTimeUnixNano: "1766927492000000000",
				endTimeUnixNano: "1766927493000000000",
				attributes: expect.arrayContaining([
					expect.objectContaining({
						key: "test.case.title",
						value: { stringValue: "should complete successfully" },
					}),
					expect.objectContaining({
						key: "playwright.test.status",
						value: { stringValue: "passed" },
					}),
				]),
			},
		);

		// 2. List and get screenshots
		const listScreenshotsResponse = await app.fetch(
			new Request(`http://localhost/otel-trace-viewer/${traceId}/screenshots`),
		);
		expect(listScreenshotsResponse.status).toBe(200);
		const screenshotsList = (await listScreenshotsResponse.json()) as {
			screenshots: Array<{ timestamp: number; file: string }>;
		};
		expect(screenshotsList.screenshots).toHaveLength(2);
		expect(screenshotsList.screenshots).toEqual([
			{
				timestamp: 1766927492200000000,
				file: "page@123-1766927492200000000.jpeg",
			},
			{
				timestamp: 1766927492700000000,
				file: "page@123-1766927492700000000.jpeg",
			},
		]);

		// 3. Fetch individual screenshot
		const getScreenshotResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/screenshots/${screenshots[0].filename}`,
			),
		);
		expect(getScreenshotResponse.status).toBe(200);
		const screenshotData = await getScreenshotResponse.arrayBuffer();
		expect(new Uint8Array(screenshotData)).toEqual(
			new Uint8Array(screenshots[0].data),
		);
	});

	it("reports a failing test OTLP payload", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// Send OTLP spans
		const otlpPayload = createOtlpPayload({
			traceId,
			serviceName: "playwright",
			spans: [
				{
					name: "playwright.test",
					startTimeUnixNano: "1766927492000000000",
					endTimeUnixNano: "1766927492500000000",
					attributes: [
						{
							key: "test.case.title",
							value: { stringValue: "should handle errors" },
						},
						{
							key: "test.case.result.status",
							value: { stringValue: "fail" },
						},
						{
							key: "playwright.test.status",
							value: { stringValue: "failed" },
						},
					],
					status: { code: 2, message: "Expected element to be visible" },
				},
			],
		});

		await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(otlpPayload),
			}),
		);

		const listOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol`,
			),
		);
		expect(listOtlpResponse.status).toBe(200);
		const otlpFiles = (await listOtlpResponse.json()) as {
			jsonFiles: string[];
		};
		expect(otlpFiles.jsonFiles).toHaveLength(1);

		const getOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol/${otlpFiles.jsonFiles[0]}`,
			),
		);
		expect(getOtlpResponse.status).toBe(200);
		const retrievedOtlp = await getOtlpResponse.json();
		expect(retrievedOtlp).toEqual(otlpPayload);
		expect(retrievedOtlp.resourceSpans[0].scopeSpans[0].spans[0]).toMatchObject(
			{
				name: "playwright.test",
				status: { code: 2, message: "Expected element to be visible" },
				attributes: expect.arrayContaining([
					expect.objectContaining({
						key: "playwright.test.status",
						value: { stringValue: "failed" },
					}),
				]),
			},
		);
	});

	it("reports a test with no screenshots", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// API-only test - no screenshots
		const otlpPayload = createOtlpPayload({
			traceId,
			serviceName: "playwright",
			spans: [
				{
					name: "test: API endpoint test",
					startTimeUnixNano: "1766927492000000000",
					endTimeUnixNano: "1766927492200000000",
				},
			],
		});

		await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(otlpPayload),
			}),
		);

		// Verify screenshots list is empty
		const listScreenshotsResponse = await app.fetch(
			new Request(`http://localhost/otel-trace-viewer/${traceId}/screenshots`),
		);
		expect(listScreenshotsResponse.status).toBe(200);
		const screenshotsList = (await listScreenshotsResponse.json()) as {
			screenshots: string[];
		};
		expect(screenshotsList.screenshots).toEqual([]);

		const listOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol`,
			),
		);
		expect(listOtlpResponse.status).toBe(200);
		const otlpFiles = (await listOtlpResponse.json()) as {
			jsonFiles: string[];
		};
		expect(otlpFiles.jsonFiles).toHaveLength(1);
	});

	it("reports a test with multiple browser pages", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// Send OTLP
		const otlpPayload = createOtlpPayload({
			traceId,
			serviceName: "playwright",
			spans: [
				{
					name: "test: multi-page test",
					startTimeUnixNano: "1766927492000000000",
					endTimeUnixNano: "1766927493000000000",
				},
			],
		});

		await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(otlpPayload),
			}),
		);

		// Send screenshots from different pages
		const screenshots = [
			{ filename: "page@abc-1766927492100000000.jpeg", pageId: "page@abc" },
			{ filename: "page@abc-1766927492300000000.jpeg", pageId: "page@abc" },
			{ filename: "popup@def-1766927492500000000.jpeg", pageId: "popup@def" },
			{ filename: "popup@def-1766927492700000000.jpeg", pageId: "popup@def" },
		];

		for (const screenshot of screenshots) {
			await app.fetch(
				new Request(
					`http://localhost/otel-playwright-reporter/screenshots/${screenshot.filename}`,
					{
						method: "PUT",
						headers: {
							"Content-Type": "image/jpeg",
							"X-Trace-Id": traceId,
						},
						body: createScreenshotBuffer(screenshot.pageId),
					},
				),
			);
		}

		// Verify all screenshots are stored and listed correctly
		const listScreenshotsResponse = await app.fetch(
			new Request(`http://localhost/otel-trace-viewer/${traceId}/screenshots`),
		);
		expect(listScreenshotsResponse.status).toBe(200);
		const screenshotsList = (await listScreenshotsResponse.json()) as {
			screenshots: Array<{ timestamp: number; file: string }>;
		};
		expect(screenshotsList.screenshots).toHaveLength(4);
		expect(screenshotsList.screenshots).toEqual([
			{
				timestamp: 1766927492100000000,
				file: "page@abc-1766927492100000000.jpeg",
			},
			{
				timestamp: 1766927492300000000,
				file: "page@abc-1766927492300000000.jpeg",
			},
			{
				timestamp: 1766927492500000000,
				file: "popup@def-1766927492500000000.jpeg",
			},
			{
				timestamp: 1766927492700000000,
				file: "popup@def-1766927492700000000.jpeg",
			},
		]);
	});

	it("reports multiple tests from a test suite", async () => {
		const app = createTestHarness();

		// Create two separate tests with different trace IDs
		const test1TraceId = generateTraceId();
		const test2TraceId = generateTraceId();

		// Test 1
		const otlp1 = createOtlpPayload({
			traceId: test1TraceId,
			spans: [
				{
					name: "test: first test",
					startTimeUnixNano: "1766927492000000000",
					endTimeUnixNano: "1766927492500000000",
				},
			],
		});

		await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(otlp1),
			}),
		);

		// Test 2
		const otlp2 = createOtlpPayload({
			traceId: test2TraceId,
			spans: [
				{
					name: "test: second test",
					startTimeUnixNano: "1766927493000000000",
					endTimeUnixNano: "1766927493500000000",
				},
			],
		});

		await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(otlp2),
			}),
		);

		// Verify traces are isolated
		// Verify OTLP files don't interfere
		const otlp1Response = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${test1TraceId}/opentelemetry-protocol`,
			),
		);
		const otlp1Files = (await otlp1Response.json()) as { jsonFiles: string[] };
		expect(otlp1Files.jsonFiles).toHaveLength(1);
		const otlp1DataResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${test1TraceId}/opentelemetry-protocol/${otlp1Files.jsonFiles[0]}`,
			),
		);
		expect(otlp1DataResponse.status).toBe(200);
		expect(await otlp1DataResponse.json()).toEqual(otlp1);

		const otlp2Response = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${test2TraceId}/opentelemetry-protocol`,
			),
		);
		const otlp2Files = (await otlp2Response.json()) as { jsonFiles: string[] };
		expect(otlp2Files.jsonFiles).toHaveLength(1);
		const otlp2DataResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${test2TraceId}/opentelemetry-protocol/${otlp2Files.jsonFiles[0]}`,
			),
		);
		expect(otlp2DataResponse.status).toBe(200);
		expect(await otlp2DataResponse.json()).toEqual(otlp2);
	});

	it("reports a test with many spans", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// Create a realistic trace with many spans
		const spans = [];
		const baseTime = 1766927492000000000;

		// Test span
		spans.push({
			name: "test: complex user journey",
			startTimeUnixNano: baseTime.toString(),
			endTimeUnixNano: (baseTime + 10000000000).toString(),
		});

		// Navigation spans
		for (let i = 0; i < 5; i++) {
			spans.push({
				name: `page.goto(/page${i})`,
				startTimeUnixNano: (baseTime + i * 2000000000).toString(),
				endTimeUnixNano: (baseTime + i * 2000000000 + 500000000).toString(),
			});
		}

		// Action spans
		const actions = ["click", "fill", "press", "hover", "select"];
		for (let i = 0; i < 20; i++) {
			const action = actions[i % actions.length];
			spans.push({
				name: `page.${action}`,
				startTimeUnixNano: (baseTime + 500000000 + i * 400000000).toString(),
				endTimeUnixNano: (
					baseTime +
					500000000 +
					i * 400000000 +
					100000000
				).toString(),
			});
		}

		// API request spans
		for (let i = 0; i < 10; i++) {
			spans.push({
				name: `fetch(/api/endpoint${i})`,
				startTimeUnixNano: (baseTime + 1000000000 + i * 300000000).toString(),
				endTimeUnixNano: (
					baseTime +
					1000000000 +
					i * 300000000 +
					50000000
				).toString(),
			});
		}

		const otlpPayload = createOtlpPayload({
			traceId,
			serviceName: "playwright",
			spans,
		});

		const otlpResponse = await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(otlpPayload),
			}),
		);
		expect(otlpResponse.status).toBe(200);

		// Verify large OTLP payload is handled correctly
		const listOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol`,
			),
		);
		expect(listOtlpResponse.status).toBe(200);
		const otlpFiles = (await listOtlpResponse.json()) as {
			jsonFiles: string[];
		};
		expect(otlpFiles.jsonFiles).toHaveLength(1);

		const getOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol/${otlpFiles.jsonFiles[0]}`,
			),
		);
		expect(getOtlpResponse.status).toBe(200);
		const retrievedOtlp = (await getOtlpResponse.json()) as {
			resourceSpans: Array<{
				scopeSpans: Array<{ spans: Array<unknown> }>;
			}>;
		};
		expect(retrievedOtlp.resourceSpans[0].scopeSpans[0].spans).toHaveLength(36); // 1 + 5 + 20 + 10
	});
});
