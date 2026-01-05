import { describe, expect, it } from "vitest";
import type { H3Event } from "h3";
import {
	createOtlpPayload,
	createScreenshotBuffer,
	createTestHarness,
	createTestJson,
	generateTraceId,
} from "./testHarness";

/**
 * Multi-Tenant Storage Tests
 *
 * Tests the resolvePath hook that enables multi-tenant storage isolation
 * by prefixing paths with organization IDs extracted from request headers.
 *
 * In production, the orgId would come from validating an auth token via middleware
 * and storing it in event.context. For testing, we read it directly from X-Org-Id header.
 */
describe("Multi-Tenant Storage", () => {
	it("isolates data by tenant using resolvePath", async () => {
		const traceId = generateTraceId();

		// Create a single app that uses X-Org-Id header for tenant isolation
		const app = createTestHarness({
			resolvePath: (event: H3Event, path: string) => {
				// In production, orgId would come from event.context.orgId set by auth middleware
				// For testing, we read it directly from the header
				const orgId = event.req.headers.get("x-org-id");
				if (!orgId) {
					throw new Error(
						"X-Org-Id header is required for multi-tenant storage",
					);
				}
				return `orgs/${orgId}/${path}`;
			},
		});

		// Tenant A: Write OTLP data
		const orgAOtlpPayload = createOtlpPayload({
			traceId,
			serviceName: "org-a-service",
			spans: [
				{
					name: "test: org A test",
					startTimeUnixNano: "1766927492000000000",
					endTimeUnixNano: "1766927493000000000",
				},
			],
		});

		const orgAOtlpResponse = await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Org-Id": "org-a",
				},
				body: JSON.stringify(orgAOtlpPayload),
			}),
		);
		expect(orgAOtlpResponse.status).toBe(200);

		// Tenant A: Write test.json
		const orgATestJson = createTestJson({
			traceId,
			name: "org A test",
			status: "passed",
		});

		const orgATestJsonResponse = await app.fetch(
			new Request("http://localhost/otel-playwright-reporter/test.json", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"X-Trace-Id": traceId,
					"X-Org-Id": "org-a",
				},
				body: JSON.stringify(orgATestJson),
			}),
		);
		expect(orgATestJsonResponse.status).toBe(200);

		// Tenant B: Write OTLP data with SAME traceId
		const orgBOtlpPayload = createOtlpPayload({
			traceId,
			serviceName: "org-b-service",
			spans: [
				{
					name: "test: org B test",
					startTimeUnixNano: "1766927492000000000",
					endTimeUnixNano: "1766927493000000000",
				},
			],
		});

		const orgBOtlpResponse = await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Org-Id": "org-b",
				},
				body: JSON.stringify(orgBOtlpPayload),
			}),
		);
		expect(orgBOtlpResponse.status).toBe(200);

		// Tenant B: Write test.json
		const orgBTestJson = createTestJson({
			traceId,
			name: "org B test",
			status: "passed",
		});

		const orgBTestJsonResponse = await app.fetch(
			new Request("http://localhost/otel-playwright-reporter/test.json", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"X-Trace-Id": traceId,
					"X-Org-Id": "org-b",
				},
				body: JSON.stringify(orgBTestJson),
			}),
		);
		expect(orgBTestJsonResponse.status).toBe(200);

		// Verification: Tenant A can read their own data
		const orgAGetResponse = await app.fetch(
			new Request(`http://localhost/otel-trace-viewer/${traceId}/test.json`, {
				headers: {
					"X-Org-Id": "org-a",
				},
			}),
		);
		expect(orgAGetResponse.status).toBe(200);
		const orgARetrieved = (await orgAGetResponse.json()) as { name: string };
		expect(orgARetrieved.name).toBe("org A test");

		// Verification: Tenant B can read their own data
		const orgBGetResponse = await app.fetch(
			new Request(`http://localhost/otel-trace-viewer/${traceId}/test.json`, {
				headers: {
					"X-Org-Id": "org-b",
				},
			}),
		);
		expect(orgBGetResponse.status).toBe(200);
		const orgBRetrieved = (await orgBGetResponse.json()) as { name: string };
		expect(orgBRetrieved.name).toBe("org B test");

		// Verification: OTLP files are isolated
		const orgAOtlpListResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol`,
				{
					headers: {
						"X-Org-Id": "org-a",
					},
				},
			),
		);
		expect(orgAOtlpListResponse.status).toBe(200);
		const orgAOtlpFiles = (await orgAOtlpListResponse.json()) as {
			jsonFiles: string[];
		};
		expect(orgAOtlpFiles.jsonFiles.length).toBeGreaterThan(0);

		const orgBOtlpListResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol`,
				{
					headers: {
						"X-Org-Id": "org-b",
					},
				},
			),
		);
		expect(orgBOtlpListResponse.status).toBe(200);
		const orgBOtlpFiles = (await orgBOtlpListResponse.json()) as {
			jsonFiles: string[];
		};
		expect(orgBOtlpFiles.jsonFiles.length).toBeGreaterThan(0);

		// Retrieve and verify the OTLP data is different for each tenant
		const orgAOtlpDataResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol/${orgAOtlpFiles.jsonFiles[0]}`,
				{
					headers: {
						"X-Org-Id": "org-a",
					},
				},
			),
		);
		const orgAOtlpData = (await orgAOtlpDataResponse.json()) as {
			resourceSpans: Array<{
				resource: {
					attributes: Array<{ key: string; value: { stringValue: string } }>;
				};
			}>;
		};
		const orgAServiceName =
			orgAOtlpData.resourceSpans[0].resource.attributes.find(
				(attr) => attr.key === "service.name",
			)?.value.stringValue;
		expect(orgAServiceName).toBe("org-a-service");

		const orgBOtlpDataResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol/${orgBOtlpFiles.jsonFiles[0]}`,
				{
					headers: {
						"X-Org-Id": "org-b",
					},
				},
			),
		);
		const orgBOtlpData = (await orgBOtlpDataResponse.json()) as {
			resourceSpans: Array<{
				resource: {
					attributes: Array<{ key: string; value: { stringValue: string } }>;
				};
			}>;
		};
		const orgBServiceName =
			orgBOtlpData.resourceSpans[0].resource.attributes.find(
				(attr) => attr.key === "service.name",
			)?.value.stringValue;
		expect(orgBServiceName).toBe("org-b-service");
	});

	it("handles complete multi-tenant workflow with screenshots", async () => {
		const traceId = generateTraceId();

		// Set up app with path resolution based on X-Org-Id header
		const app = createTestHarness({
			resolvePath: (event: H3Event, path: string) => {
				// In production, orgId would come from event.context.orgId set by auth middleware
				// For testing, we read it directly from the header
				const orgId = event.req.headers.get("x-org-id");
				if (!orgId) {
					throw new Error(
						"X-Org-Id header is required for multi-tenant storage",
					);
				}
				return `orgs/${orgId}/${path}`;
			},
		});

		// Step 1: Send OTLP spans (from Playwright)
		const playwrightOtlp = createOtlpPayload({
			traceId,
			serviceName: "playwright",
			spans: [
				{
					name: "test: complete user journey",
					startTimeUnixNano: "1766927492000000000",
					endTimeUnixNano: "1766927495000000000",
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

		const playwrightOtlpResponse = await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Org-Id": "tenant-123",
				},
				body: JSON.stringify(playwrightOtlp),
			}),
		);
		expect(playwrightOtlpResponse.status).toBe(200);

		// Step 2: Send OTLP spans from backend service (simulating external trace)
		const backendOtlp = createOtlpPayload({
			traceId,
			serviceName: "backend-api",
			spans: [
				{
					name: "HTTP GET /api/users",
					startTimeUnixNano: "1766927492200000000",
					endTimeUnixNano: "1766927492400000000",
				},
				{
					name: "database.query",
					startTimeUnixNano: "1766927492250000000",
					endTimeUnixNano: "1766927492350000000",
				},
			],
		});

		const backendOtlpResponse = await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Org-Id": "tenant-123",
				},
				body: JSON.stringify(backendOtlp),
			}),
		);
		expect(backendOtlpResponse.status).toBe(200);

		// Step 3: Send test.json
		const testJson = createTestJson({
			traceId,
			name: "complete user journey",
			status: "passed",
			describes: ["User flows", "E2E tests"],
		});

		const testJsonResponse = await app.fetch(
			new Request("http://localhost/otel-playwright-reporter/test.json", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"X-Trace-Id": traceId,
					"X-Org-Id": "tenant-123",
				},
				body: JSON.stringify(testJson),
			}),
		);
		expect(testJsonResponse.status).toBe(200);

		// Step 4: Send screenshots
		const screenshots = [
			{
				filename: "page@abc-1766927492300000000.jpeg",
				data: createScreenshotBuffer("initial-load"),
			},
			{
				filename: "page@abc-1766927492700000000.jpeg",
				data: createScreenshotBuffer("after-click"),
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
							"X-Org-Id": "tenant-123",
						},
						body: screenshot.data,
					},
				),
			);
			expect(screenshotResponse.status).toBe(200);
		}

		// Verification: Read back complete trace via viewer API
		// All reads should go through the same resolvePath transformation

		// 1. Verify test.json
		const getTestJsonResponse = await app.fetch(
			new Request(`http://localhost/otel-trace-viewer/${traceId}/test.json`, {
				headers: {
					"X-Org-Id": "tenant-123",
				},
			}),
		);
		expect(getTestJsonResponse.status).toBe(200);
		const retrievedTestJson = await getTestJsonResponse.json();
		expect(retrievedTestJson).toEqual(testJson);

		// 2. Verify OTLP files (should have both playwright and backend-api)
		const listOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol`,
				{
					headers: {
						"X-Org-Id": "tenant-123",
					},
				},
			),
		);
		expect(listOtlpResponse.status).toBe(200);
		const otlpFiles = (await listOtlpResponse.json()) as {
			jsonFiles: string[];
		};
		expect(otlpFiles.jsonFiles).toHaveLength(2);

		// Sort to ensure consistent ordering for assertions
		const sortedOtlpFiles = otlpFiles.jsonFiles.sort();

		// Verify both OTLP files can be retrieved
		const getPlaywrightOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol/${sortedOtlpFiles[1]}`,
				{
					headers: {
						"X-Org-Id": "tenant-123",
					},
				},
			),
		);
		expect(getPlaywrightOtlpResponse.status).toBe(200);
		const retrievedPlaywrightOtlp = await getPlaywrightOtlpResponse.json();
		expect(retrievedPlaywrightOtlp).toEqual(playwrightOtlp);

		const getBackendOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol/${sortedOtlpFiles[0]}`,
				{
					headers: {
						"X-Org-Id": "tenant-123",
					},
				},
			),
		);
		expect(getBackendOtlpResponse.status).toBe(200);
		const retrievedBackendOtlp = await getBackendOtlpResponse.json();
		expect(retrievedBackendOtlp).toEqual(backendOtlp);

		// 3. Verify screenshots
		const listScreenshotsResponse = await app.fetch(
			new Request(`http://localhost/otel-trace-viewer/${traceId}/screenshots`, {
				headers: {
					"X-Org-Id": "tenant-123",
				},
			}),
		);
		expect(listScreenshotsResponse.status).toBe(200);
		const screenshotsList = (await listScreenshotsResponse.json()) as {
			screenshots: Array<{ timestamp: number; file: string }>;
		};
		expect(screenshotsList.screenshots).toHaveLength(2);
		expect(screenshotsList.screenshots).toEqual([
			{
				timestamp: 1766927492300000000,
				file: "page@abc-1766927492300000000.jpeg",
			},
			{
				timestamp: 1766927492700000000,
				file: "page@abc-1766927492700000000.jpeg",
			},
		]);

		// Verify individual screenshot retrieval
		const getScreenshotResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/screenshots/${screenshots[0].filename}`,
				{
					headers: {
						"X-Org-Id": "tenant-123",
					},
				},
			),
		);
		expect(getScreenshotResponse.status).toBe(200);
		const screenshotData = await getScreenshotResponse.arrayBuffer();
		expect(new Uint8Array(screenshotData)).toEqual(
			new Uint8Array(screenshots[0].data),
		);
	});
});
