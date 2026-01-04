import { describe, expect, it } from "vitest";
import {
	createOtlpPayload,
	createScreenshotBuffer,
	createTestHarness,
	createTestJson,
	generateSpanId,
	generateTraceId,
} from "./testHarness";

/**
 * Backend Instrumentation Integration Tests
 *
 * Mimics backend services (API servers, databases, etc.) sending OTLP spans
 * that correlate with Playwright test traces via the traceparent header.
 */
describe("Backend Instrumentation", () => {
	it("backend API sends correlated spans", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// Backend service receives request with traceparent header and sends OTLP
		const backendOtlp = createOtlpPayload({
			traceId,
			serviceName: "backend-api",
			spans: [
				{
					name: "GET /api/users",
					startTimeUnixNano: "1766927492200000000",
					endTimeUnixNano: "1766927492400000000",
				},
				{
					name: "database query",
					startTimeUnixNano: "1766927492250000000",
					endTimeUnixNano: "1766927492350000000",
				},
			],
		});

		const backendResponse = await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(backendOtlp),
			}),
		);
		expect(backendResponse.status).toBe(200);

		// Playwright sends its own OTLP
		const playwrightOtlp = createOtlpPayload({
			traceId,
			serviceName: "playwright",
			spans: [
				{
					name: "test: should load users",
					startTimeUnixNano: "1766927492000000000",
					endTimeUnixNano: "1766927493000000000",
				},
				{
					name: "page.goto",
					startTimeUnixNano: "1766927492100000000",
					endTimeUnixNano: "1766927492150000000",
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

		// Playwright sends test.json
		const testJson = createTestJson({
			traceId,
			name: "should load users",
			status: "passed",
			describes: ["Backend integration"],
			file: "tests/backend.spec.ts",
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

		// Verify both Playwright and backend spans appear in the trace
		const listOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/test-traces/${traceId}/opentelemetry-protocol`,
			),
		);
		expect(listOtlpResponse.status).toBe(200);
		const otlpFiles = (await listOtlpResponse.json()) as {
			jsonFiles: string[];
		};
		expect(otlpFiles.jsonFiles).toHaveLength(2);
		expect(otlpFiles.jsonFiles.some((f) => f.includes("backend-api"))).toBe(
			true,
		);
		expect(otlpFiles.jsonFiles.some((f) => f.includes("playwright"))).toBe(
			true,
		);
	});

	it("multiple services in a request chain", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// Service chain: API → Service → Database
		const apiOtlp = createOtlpPayload({
			traceId,
			serviceName: "api-gateway",
			spans: [
				{
					name: "POST /orders",
					startTimeUnixNano: "1766927492100000000",
					endTimeUnixNano: "1766927492600000000",
				},
			],
		});

		const serviceOtlp = createOtlpPayload({
			traceId,
			serviceName: "order-service",
			spans: [
				{
					name: "createOrder",
					startTimeUnixNano: "1766927492200000000",
					endTimeUnixNano: "1766927492500000000",
				},
			],
		});

		const databaseOtlp = createOtlpPayload({
			traceId,
			serviceName: "postgres",
			spans: [
				{
					name: "INSERT INTO orders",
					startTimeUnixNano: "1766927492300000000",
					endTimeUnixNano: "1766927492400000000",
				},
			],
		});

		// All services send OTLP
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
				body: JSON.stringify(serviceOtlp),
			}),
		);

		await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(databaseOtlp),
			}),
		);

		// Playwright sends test.json
		const testJson = createTestJson({
			traceId,
			name: "test with backend instrumentation",
			status: "passed",
			describes: ["Backend integration"],
			file: "tests/backend.spec.ts",
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

		// Verify all three services appear in OTLP file listing
		const listOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/test-traces/${traceId}/opentelemetry-protocol`,
			),
		);
		expect(listOtlpResponse.status).toBe(200);
		const otlpFiles = (await listOtlpResponse.json()) as {
			jsonFiles: string[];
		};
		expect(otlpFiles.jsonFiles).toHaveLength(3); // 3 backend services
		expect(otlpFiles.jsonFiles.some((f) => f.includes("api-gateway"))).toBe(
			true,
		);
		expect(otlpFiles.jsonFiles.some((f) => f.includes("order-service"))).toBe(
			true,
		);
		expect(otlpFiles.jsonFiles.some((f) => f.includes("postgres"))).toBe(true);
	});

	it("backend spans arrive before test completes", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// Backend sends OTLP first (early in test execution)
		const backendOtlp = createOtlpPayload({
			traceId,
			serviceName: "backend-api",
			spans: [
				{
					name: "GET /api/data",
					startTimeUnixNano: "1766927492100000000",
					endTimeUnixNano: "1766927492300000000",
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

		// Playwright sends test.json
		const testJson = createTestJson({
			traceId,
			name: "test with backend instrumentation",
			status: "passed",
			describes: ["Backend integration"],
			file: "tests/backend.spec.ts",
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

		// Verify both are present in final trace
		const getTestJsonResponse = await app.fetch(
			new Request(`http://localhost/test-traces/${traceId}/test.json`),
		);
		expect(getTestJsonResponse.status).toBe(200);

		const listOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/test-traces/${traceId}/opentelemetry-protocol`,
			),
		);
		expect(listOtlpResponse.status).toBe(200);
		const otlpFiles = (await listOtlpResponse.json()) as {
			jsonFiles: string[];
		};
		expect(otlpFiles.jsonFiles.some((f) => f.includes("backend-api"))).toBe(
			true,
		);
	});

	it("backend spans arrive after test completes", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// Playwright sends everything first
		const playwrightOtlp = createOtlpPayload({
			traceId,
			serviceName: "playwright",
			spans: [
				{
					name: "test: delayed backend processing",
					startTimeUnixNano: "1766927492000000000",
					endTimeUnixNano: "1766927493000000000",
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

		const testJson = createTestJson({
			traceId,
			name: "delayed backend processing",
			status: "passed",
			describes: ["Backend integration"],
			file: "tests/backend.spec.ts",
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

		await app.fetch(
			new Request(
				"http://localhost/playwright-opentelemetry/screenshots/page@123-1766927492500000000.jpeg",
				{
					method: "PUT",
					headers: {
						"Content-Type": "image/jpeg",
						"X-Trace-Id": traceId,
					},
					body: createScreenshotBuffer(),
				},
			),
		);

		// Backend OTLP arrives late (async processing)
		const backendOtlp = createOtlpPayload({
			traceId,
			serviceName: "async-worker",
			spans: [
				{
					name: "process background job",
					startTimeUnixNano: "1766927493100000000",
					endTimeUnixNano: "1766927493500000000",
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

		// Verify late spans are added to existing trace
		const listOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/test-traces/${traceId}/opentelemetry-protocol`,
			),
		);
		expect(listOtlpResponse.status).toBe(200);
		const otlpFiles = (await listOtlpResponse.json()) as {
			jsonFiles: string[];
		};
		expect(otlpFiles.jsonFiles).toHaveLength(2);
		expect(otlpFiles.jsonFiles.some((f) => f.includes("async-worker"))).toBe(
			true,
		);
		expect(otlpFiles.jsonFiles.some((f) => f.includes("playwright"))).toBe(
			true,
		);
	});

	it("multiple OTLP batches from same service", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// Service sends spans in multiple POST requests (batching)
		const batch1 = createOtlpPayload({
			traceId,
			serviceName: "backend-api",
			spans: [
				{
					name: "request batch 1",
					spanId: "span1",
					startTimeUnixNano: "1766927492100000000",
					endTimeUnixNano: "1766927492200000000",
				},
			],
		});

		const batch2 = createOtlpPayload({
			traceId,
			serviceName: "backend-api",
			spans: [
				{
					name: "request batch 2",
					spanId: "span2",
					startTimeUnixNano: "1766927492300000000",
					endTimeUnixNano: "1766927492400000000",
				},
			],
		});

		const batch3 = createOtlpPayload({
			traceId,
			serviceName: "backend-api",
			spans: [
				{
					name: "request batch 3",
					spanId: "span3",
					startTimeUnixNano: "1766927492500000000",
					endTimeUnixNano: "1766927492600000000",
				},
			],
		});

		// Send each batch separately
		await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(batch1),
			}),
		);

		await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(batch2),
			}),
		);

		await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(batch3),
			}),
		);

		// Verify all batches are stored as separate files
		const listOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/test-traces/${traceId}/opentelemetry-protocol`,
			),
		);
		expect(listOtlpResponse.status).toBe(200);
		const otlpFiles = (await listOtlpResponse.json()) as {
			jsonFiles: string[];
		};
		expect(otlpFiles.jsonFiles).toHaveLength(3);
		expect(otlpFiles.jsonFiles[0]).toContain("backend-api-span1");
		expect(otlpFiles.jsonFiles[1]).toContain("backend-api-span2");
		expect(otlpFiles.jsonFiles[2]).toContain("backend-api-span3");
	});

	it("orphan spans with no corresponding test", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		// Backend sends OTLP but no Playwright test.json ever arrives
		const backendOtlp = createOtlpPayload({
			traceId,
			serviceName: "backend-api",
			spans: [
				{
					name: "GET /api/orphan",
					startTimeUnixNano: "1766927492100000000",
					endTimeUnixNano: "1766927492300000000",
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

		// Verify OTLP is stored (will be cleaned up by lifecycle policy later)
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

		// test.json should not exist
		const getTestJsonResponse = await app.fetch(
			new Request(`http://localhost/test-traces/${traceId}/test.json`),
		);
		expect(getTestJsonResponse.status).toBe(404);
	});

	it("single OTLP post with spans from multiple traces", async () => {
		const app = createTestHarness();
		const traceId1 = generateTraceId();
		const traceId2 = generateTraceId();

		// A backend service batches spans from different traces in one POST
		// This is totally reasonable - the OTLP exporter may batch across traces
		const mixedOtlp = {
			resourceSpans: [
				{
					resource: {
						attributes: [
							{
								key: "service.name",
								value: { stringValue: "backend-api" },
							},
						],
					},
					scopeSpans: [
						{
							scope: { name: "backend-api-instrumentation" },
							spans: [
								{
									traceId: traceId1,
									spanId: generateSpanId(),
									name: "GET /api/users",
									startTimeUnixNano: "1766927492100000000",
									endTimeUnixNano: "1766927492300000000",
									status: { code: 1 },
								},
								{
									traceId: traceId2,
									spanId: generateSpanId(),
									name: "GET /api/orders",
									startTimeUnixNano: "1766927492150000000",
									endTimeUnixNano: "1766927492350000000",
									status: { code: 1 },
								},
							],
						},
					],
				},
			],
		};

		await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(mixedOtlp),
			}),
		);

		// Verify trace 1 has its span
		const listOtlp1Response = await app.fetch(
			new Request(
				`http://localhost/test-traces/${traceId1}/opentelemetry-protocol`,
			),
		);
		expect(listOtlp1Response.status).toBe(200);
		const otlp1Files = (await listOtlp1Response.json()) as {
			jsonFiles: string[];
		};
		expect(otlp1Files.jsonFiles).toHaveLength(1);
		expect(otlp1Files.jsonFiles[0]).toContain("backend-api");

		// Verify the stored file for trace 1 only contains spans from trace 1
		const trace1Filename = otlp1Files.jsonFiles[0];
		const trace1FileResponse = await app.fetch(
			new Request(
				`http://localhost/test-traces/${traceId1}/opentelemetry-protocol/${trace1Filename}`,
			),
		);
		expect(trace1FileResponse.status).toBe(200);
		const trace1Content = (await trace1FileResponse.json()) as {
			resourceSpans: Array<{
				scopeSpans: Array<{ spans: Array<{ name: string; traceId: string }> }>;
			}>;
		};
		const trace1Spans =
			trace1Content.resourceSpans[0].scopeSpans[0].spans || [];
		expect(trace1Spans).toHaveLength(1);
		expect(trace1Spans[0].name).toBe("GET /api/users");
		expect(trace1Spans[0].traceId).toBe(traceId1);

		// Verify trace 2 has its span
		const listOtlp2Response = await app.fetch(
			new Request(
				`http://localhost/test-traces/${traceId2}/opentelemetry-protocol`,
			),
		);
		expect(listOtlp2Response.status).toBe(200);
		const otlp2Files = (await listOtlp2Response.json()) as {
			jsonFiles: string[];
		};
		expect(otlp2Files.jsonFiles).toHaveLength(1);
		expect(otlp2Files.jsonFiles[0]).toContain("backend-api");

		// Verify the stored file for trace 2 only contains spans from trace 2
		const trace2Filename = otlp2Files.jsonFiles[0];
		const trace2FileResponse = await app.fetch(
			new Request(
				`http://localhost/test-traces/${traceId2}/opentelemetry-protocol/${trace2Filename}`,
			),
		);
		expect(trace2FileResponse.status).toBe(200);
		const trace2Content = (await trace2FileResponse.json()) as {
			resourceSpans: Array<{
				scopeSpans: Array<{ spans: Array<{ name: string; traceId: string }> }>;
			}>;
		};
		const trace2Spans =
			trace2Content.resourceSpans[0].scopeSpans[0].spans || [];
		expect(trace2Spans).toHaveLength(1);
		expect(trace2Spans[0].name).toBe("GET /api/orders");
		expect(trace2Spans[0].traceId).toBe(traceId2);
	});
});
