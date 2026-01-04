import { describe, expect, it } from "vitest";
import {
	createOtlpPayload,
	createScreenshotBuffer,
	createTestHarness,
	createTestJson,
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
					name: "test: should complete successfully",
					startTimeUnixNano: "1766927492000000000",
					endTimeUnixNano: "1766927493000000000",
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

		// Step 2: Send test.json
		const testJson = createTestJson({
			traceId,
			name: "should complete successfully",
			status: "passed",
			describes: ["Example suite"],
		});

		const testJsonResponse = await app.fetch(
			new Request("http://localhost/playwright-opentelemetry/test.json", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"X-Trace-Id": traceId,
				},
				body: JSON.stringify(testJson),
			}),
		);
		expect(testJsonResponse.status).toBe(200);

		// Step 3: Send screenshots
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
					`http://localhost/playwright-opentelemetry/screenshots/${screenshot.filename}`,
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
		// 1. Get test.json
		const getTestJsonResponse = await app.fetch(
			new Request(`http://localhost/test-traces/${traceId}/test.json`),
		);
		expect(getTestJsonResponse.status).toBe(200);
		expect(await getTestJsonResponse.json()).toEqual(testJson);

		// 2. List and get OTLP files
		const listOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/test-traces/${traceId}/opentelemetry-protocol`,
			),
		);
		expect(listOtlpResponse.status).toBe(200);
		const otlpFiles = (await listOtlpResponse.json()) as {
			jsonFiles: string[];
		};
		expect(otlpFiles.jsonFiles).toHaveLength(1);

		const getOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/test-traces/${traceId}/opentelemetry-protocol/${otlpFiles.jsonFiles[0]}`,
			),
		);
		expect(getOtlpResponse.status).toBe(200);
		expect(await getOtlpResponse.json()).toEqual(otlpPayload);

		// 3. List and get screenshots
		const listScreenshotsResponse = await app.fetch(
			new Request(`http://localhost/test-traces/${traceId}/screenshots`),
		);
		expect(listScreenshotsResponse.status).toBe(200);
		const screenshotsList = (await listScreenshotsResponse.json()) as {
			screenshots: string[];
		};
		expect(screenshotsList.screenshots).toHaveLength(2);
		expect(screenshotsList.screenshots).toEqual([
			"page@123-1766927492200000000.jpeg",
			"page@123-1766927492700000000.jpeg",
		]);

		// 4. Fetch individual screenshot
		const getScreenshotResponse = await app.fetch(
			new Request(
				`http://localhost/test-traces/${traceId}/screenshots/${screenshots[0].filename}`,
			),
		);
		expect(getScreenshotResponse.status).toBe(200);
		const screenshotData = await getScreenshotResponse.arrayBuffer();
		expect(new Uint8Array(screenshotData)).toEqual(
			new Uint8Array(screenshots[0].data),
		);
	});

	it("reports a failing test with error information", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// Send OTLP spans
		const otlpPayload = createOtlpPayload({
			traceId,
			serviceName: "playwright",
			spans: [
				{
					name: "test: should handle errors",
					startTimeUnixNano: "1766927492000000000",
					endTimeUnixNano: "1766927492500000000",
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

		// Send test.json with error
		const testJson = createTestJson({
			traceId,
			name: "should handle errors",
			status: "failed",
			describes: ["Error handling suite"],
			error: {
				message: "Expected element to be visible",
				stack:
					"Error: Expected element to be visible\n    at test.spec.ts:15:20",
			},
		});

		await app.fetch(
			new Request("http://localhost/playwright-opentelemetry/test.json", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"X-Trace-Id": traceId,
				},
				body: JSON.stringify(testJson),
			}),
		);

		// Verify error information is preserved
		const getTestJsonResponse = await app.fetch(
			new Request(`http://localhost/test-traces/${traceId}/test.json`),
		);
		expect(getTestJsonResponse.status).toBe(200);
		const retrievedTestJson = (await getTestJsonResponse.json()) as {
			status: string;
			error: { message: string; stack: string };
		};
		expect(retrievedTestJson.status).toBe("failed");
		expect(retrievedTestJson.error).toEqual({
			message: "Expected element to be visible",
			stack: "Error: Expected element to be visible\n    at test.spec.ts:15:20",
		});
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

		const testJson = createTestJson({
			traceId,
			name: "API endpoint test",
			status: "passed",
			describes: ["API tests"],
		});

		await app.fetch(
			new Request("http://localhost/playwright-opentelemetry/test.json", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"X-Trace-Id": traceId,
				},
				body: JSON.stringify(testJson),
			}),
		);

		// Verify screenshots list is empty
		const listScreenshotsResponse = await app.fetch(
			new Request(`http://localhost/test-traces/${traceId}/screenshots`),
		);
		expect(listScreenshotsResponse.status).toBe(200);
		const screenshotsList = (await listScreenshotsResponse.json()) as {
			screenshots: string[];
		};
		expect(screenshotsList.screenshots).toEqual([]);
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

		// Send test.json
		const testJson = createTestJson({
			traceId,
			name: "multi-page test",
			status: "passed",
		});

		await app.fetch(
			new Request("http://localhost/playwright-opentelemetry/test.json", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"X-Trace-Id": traceId,
				},
				body: JSON.stringify(testJson),
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
					`http://localhost/playwright-opentelemetry/screenshots/${screenshot.filename}`,
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
			new Request(`http://localhost/test-traces/${traceId}/screenshots`),
		);
		expect(listScreenshotsResponse.status).toBe(200);
		const screenshotsList = (await listScreenshotsResponse.json()) as {
			screenshots: string[];
		};
		expect(screenshotsList.screenshots).toHaveLength(4);
		expect(screenshotsList.screenshots).toEqual([
			"page@abc-1766927492100000000.jpeg",
			"page@abc-1766927492300000000.jpeg",
			"popup@def-1766927492500000000.jpeg",
			"popup@def-1766927492700000000.jpeg",
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

		const testJson1 = createTestJson({
			traceId: test1TraceId,
			name: "first test",
			status: "passed",
		});

		await app.fetch(
			new Request("http://localhost/playwright-opentelemetry/test.json", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"X-Trace-Id": test1TraceId,
				},
				body: JSON.stringify(testJson1),
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

		const testJson2 = createTestJson({
			traceId: test2TraceId,
			name: "second test",
			status: "passed",
		});

		await app.fetch(
			new Request("http://localhost/playwright-opentelemetry/test.json", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"X-Trace-Id": test2TraceId,
				},
				body: JSON.stringify(testJson2),
			}),
		);

		// Verify traces are isolated
		const test1Response = await app.fetch(
			new Request(`http://localhost/test-traces/${test1TraceId}/test.json`),
		);
		expect(test1Response.status).toBe(200);
		const test1Data = (await test1Response.json()) as { name: string };
		expect(test1Data.name).toBe("first test");

		const test2Response = await app.fetch(
			new Request(`http://localhost/test-traces/${test2TraceId}/test.json`),
		);
		expect(test2Response.status).toBe(200);
		const test2Data = (await test2Response.json()) as { name: string };
		expect(test2Data.name).toBe("second test");

		// Verify OTLP files don't interfere
		const otlp1Response = await app.fetch(
			new Request(
				`http://localhost/test-traces/${test1TraceId}/opentelemetry-protocol`,
			),
		);
		const otlp1Files = (await otlp1Response.json()) as { jsonFiles: string[] };
		expect(otlp1Files.jsonFiles).toHaveLength(1);

		const otlp2Response = await app.fetch(
			new Request(
				`http://localhost/test-traces/${test2TraceId}/opentelemetry-protocol`,
			),
		);
		const otlp2Files = (await otlp2Response.json()) as { jsonFiles: string[] };
		expect(otlp2Files.jsonFiles).toHaveLength(1);
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

		// Send test.json
		const testJson = createTestJson({
			traceId,
			name: "complex user journey",
			status: "passed",
		});

		await app.fetch(
			new Request("http://localhost/playwright-opentelemetry/test.json", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"X-Trace-Id": traceId,
				},
				body: JSON.stringify(testJson),
			}),
		);

		// Verify large OTLP payload is handled correctly
		const listOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/test-traces/${traceId}/opentelemetry-protocol`,
			),
		);
		expect(listOtlpResponse.status).toBe(200);
		const otlpFiles = (await listOtlpResponse.json()) as {
			jsonFiles: string[];
		};
		expect(otlpFiles.jsonFiles).toHaveLength(1);

		const getOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/test-traces/${traceId}/opentelemetry-protocol/${otlpFiles.jsonFiles[0]}`,
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
