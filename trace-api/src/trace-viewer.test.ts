import { describe, expect, it } from "vitest";
import {
	createOtlpPayload,
	createScreenshotBuffer,
	createTestHarness,
	createTestJson,
	generateTraceId,
} from "./testHarness";

/**
 * Trace Viewer Integration Tests
 *
 * Mimics what the trace-viewer application does when a user loads and explores a trace.
 */
describe("Trace Viewer", () => {
	it("loads a complete trace", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// Setup: Write test data
		const otlpPayload = createOtlpPayload({
			traceId,
			serviceName: "playwright",
			spans: [
				{
					name: "test: complete trace",
					startTimeUnixNano: "1766927492000000000",
					endTimeUnixNano: "1766927493000000000",
				},
				{
					name: "page.goto",
					startTimeUnixNano: "1766927492100000000",
					endTimeUnixNano: "1766927492300000000",
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
			name: "complete trace",
			status: "passed",
		});

		await app.fetch(
			new Request("http://localhost/otel-playwright-reporter/test.json", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"X-Trace-Id": traceId,
				},
				body: JSON.stringify(testJson),
			}),
		);

		const screenshots = [
			{ filename: "page@abc-1766927492200000000.jpeg" },
			{ filename: "page@abc-1766927492500000000.jpeg" },
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
						body: createScreenshotBuffer(screenshot.filename),
					},
				),
			);
		}

		// Viewer flow: Load complete trace
		// 1. Get test.json for metadata
		const getTestJsonResponse = await app.fetch(
			new Request(`http://localhost/otel-trace-viewer/${traceId}/test.json`),
		);
		expect(getTestJsonResponse.status).toBe(200);
		expect(await getTestJsonResponse.json()).toEqual(testJson);

		// 2. List OTLP files
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

		// 3. Fetch each OTLP file
		const getOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol/${otlpFiles.jsonFiles[0]}`,
			),
		);
		expect(getOtlpResponse.status).toBe(200);
		expect(await getOtlpResponse.json()).toEqual(otlpPayload);

		// 4. List screenshots
		const listScreenshotsResponse = await app.fetch(
			new Request(`http://localhost/otel-trace-viewer/${traceId}/screenshots`),
		);
		expect(listScreenshotsResponse.status).toBe(200);
		const screenshotsList = (await listScreenshotsResponse.json()) as {
			screenshots: string[];
		};
		expect(screenshotsList.screenshots).toHaveLength(2);

		// 5. Fetch screenshots for filmstrip
		const getScreenshotResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/screenshots/${screenshots[0].filename}`,
			),
		);
		expect(getScreenshotResponse.status).toBe(200);
		const screenshotData = await getScreenshotResponse.arrayBuffer();
		expect(screenshotData.byteLength).toBeGreaterThan(0);
	});

	it("loads a trace with multiple OTLP sources", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// Setup: Playwright + multiple backend services
		const playwrightOtlp = createOtlpPayload({
			traceId,
			serviceName: "playwright",
			spans: [
				{
					name: "test: multi-service trace",
					startTimeUnixNano: "1766927492000000000",
					endTimeUnixNano: "1766927493000000000",
				},
			],
		});

		const apiOtlp = createOtlpPayload({
			traceId,
			serviceName: "api-service",
			spans: [
				{
					name: "GET /api/data",
					startTimeUnixNano: "1766927492100000000",
					endTimeUnixNano: "1766927492300000000",
				},
			],
		});

		const dbOtlp = createOtlpPayload({
			traceId,
			serviceName: "database",
			spans: [
				{
					name: "SELECT * FROM users",
					startTimeUnixNano: "1766927492150000000",
					endTimeUnixNano: "1766927492250000000",
				},
			],
		});

		await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(playwrightOtlp),
			}),
		);

		await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(apiOtlp),
			}),
		);

		await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(dbOtlp),
			}),
		);

		const testJson = createTestJson({
			traceId,
			name: "multi-service trace",
			status: "passed",
		});

		await app.fetch(
			new Request("http://localhost/otel-playwright-reporter/test.json", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"X-Trace-Id": traceId,
				},
				body: JSON.stringify(testJson),
			}),
		);

		// Viewer: List OTLP sources
		const listOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol`,
			),
		);
		expect(listOtlpResponse.status).toBe(200);
		const otlpFiles = (await listOtlpResponse.json()) as {
			jsonFiles: string[];
		};
		expect(otlpFiles.jsonFiles).toHaveLength(3);

		// Viewer: Fetch each source
		for (const filename of otlpFiles.jsonFiles) {
			const response = await app.fetch(
				new Request(
					`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol/${filename}`,
				),
			);
			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data).toHaveProperty("resourceSpans");
		}
	});

	it("loads screenshots for filmstrip display", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// Setup
		const testJson = createTestJson({
			traceId,
			name: "screenshot test",
			status: "passed",
		});

		await app.fetch(
			new Request("http://localhost/otel-playwright-reporter/test.json", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"X-Trace-Id": traceId,
				},
				body: JSON.stringify(testJson),
			}),
		);

		// Upload screenshots with timestamps in order
		const screenshots = [
			{ filename: "page@abc-1766927492100000000.jpeg", timestamp: 100 },
			{ filename: "page@abc-1766927492300000000.jpeg", timestamp: 300 },
			{ filename: "page@abc-1766927492200000000.jpeg", timestamp: 200 }, // Out of order
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
						body: createScreenshotBuffer(screenshot.filename),
					},
				),
			);
		}

		// Viewer: List screenshots (should be sorted by timestamp)
		const listScreenshotsResponse = await app.fetch(
			new Request(`http://localhost/otel-trace-viewer/${traceId}/screenshots`),
		);
		expect(listScreenshotsResponse.status).toBe(200);
		const screenshotsList = (await listScreenshotsResponse.json()) as {
			screenshots: Array<{ timestamp: number; file: string }>;
		};
		expect(screenshotsList.screenshots).toHaveLength(3);
		// Verify sorted order with timestamp and file properties
		expect(screenshotsList.screenshots).toEqual([
			{
				timestamp: 1766927492100000000,
				file: "page@abc-1766927492100000000.jpeg",
			},
			{
				timestamp: 1766927492200000000,
				file: "page@abc-1766927492200000000.jpeg",
			},
			{
				timestamp: 1766927492300000000,
				file: "page@abc-1766927492300000000.jpeg",
			},
		]);

		// Viewer: Fetch individual images for display
		for (const screenshot of screenshotsList.screenshots) {
			const response = await app.fetch(
				new Request(
					`http://localhost/otel-trace-viewer/${traceId}/screenshots/${screenshot.file}`,
				),
			);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("image/jpeg");
		}
	});

	it("handles non-existent trace", async () => {
		const app = createTestHarness();
		const nonExistentTraceId = generateTraceId();

		// Attempt to load a trace that doesn't exist
		const getTestJsonResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${nonExistentTraceId}/test.json`,
			),
		);
		expect(getTestJsonResponse.status).toBe(404);

		const listOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${nonExistentTraceId}/opentelemetry-protocol`,
			),
		);
		expect(listOtlpResponse.status).toBe(200);
		const otlpFiles = (await listOtlpResponse.json()) as {
			jsonFiles: string[];
		};
		expect(otlpFiles.jsonFiles).toEqual([]);

		const listScreenshotsResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${nonExistentTraceId}/screenshots`,
			),
		);
		expect(listScreenshotsResponse.status).toBe(200);
		const screenshotsList = (await listScreenshotsResponse.json()) as {
			screenshots: string[];
		};
		expect(screenshotsList.screenshots).toEqual([]);
	});

	it("handles partial trace (OTLP only, no test.json)", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// Backend-only trace or test still in progress
		const backendOtlp = createOtlpPayload({
			traceId,
			serviceName: "backend-api",
			spans: [
				{
					name: "GET /api/endpoint",
					startTimeUnixNano: "1766927492000000000",
					endTimeUnixNano: "1766927492200000000",
				},
			],
		});

		await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(backendOtlp),
			}),
		);

		// Viewer can still show spans without test metadata
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
		expect(await getOtlpResponse.json()).toEqual(backendOtlp);

		// test.json doesn't exist
		const getTestJsonResponse = await app.fetch(
			new Request(`http://localhost/otel-trace-viewer/${traceId}/test.json`),
		);
		expect(getTestJsonResponse.status).toBe(404);
	});

	it("handles trace with no screenshots", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// Setup trace without screenshots
		const otlpPayload = createOtlpPayload({
			traceId,
			serviceName: "playwright",
			spans: [
				{
					name: "test: no screenshots",
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

		const testJson = createTestJson({
			traceId,
			name: "no screenshots",
			status: "passed",
		});

		await app.fetch(
			new Request("http://localhost/otel-playwright-reporter/test.json", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"X-Trace-Id": traceId,
				},
				body: JSON.stringify(testJson),
			}),
		);

		// Viewer: Verify empty screenshots array
		const listScreenshotsResponse = await app.fetch(
			new Request(`http://localhost/otel-trace-viewer/${traceId}/screenshots`),
		);
		expect(listScreenshotsResponse.status).toBe(200);
		const screenshotsList = (await listScreenshotsResponse.json()) as {
			screenshots: string[];
		};
		expect(screenshotsList.screenshots).toEqual([]);
	});

	it("handles trace with no OTLP files", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// Edge case: test.json exists but no OTLP yet
		const testJson = createTestJson({
			traceId,
			name: "no OTLP",
			status: "passed",
		});

		await app.fetch(
			new Request("http://localhost/otel-playwright-reporter/test.json", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"X-Trace-Id": traceId,
				},
				body: JSON.stringify(testJson),
			}),
		);

		// Viewer: test.json exists
		const getTestJsonResponse = await app.fetch(
			new Request(`http://localhost/otel-trace-viewer/${traceId}/test.json`),
		);
		expect(getTestJsonResponse.status).toBe(200);

		// Viewer: Verify empty jsonFiles array
		const listOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol`,
			),
		);
		expect(listOtlpResponse.status).toBe(200);
		const otlpFiles = (await listOtlpResponse.json()) as {
			jsonFiles: string[];
		};
		expect(otlpFiles.jsonFiles).toEqual([]);
	});
});
