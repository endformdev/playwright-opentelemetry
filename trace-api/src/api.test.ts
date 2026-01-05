import { describe, expect, it } from "vitest";
import { createTestHarness } from "./testHarness";

describe("Trace API integration", () => {
	it("should store OTLP data and test.json, then retrieve them", async () => {
		const app = createTestHarness();

		const traceId = "7709187832dca84f02f413a312421586";

		// Step 1: POST OTLP data to /v1/traces
		const otlpPayload = {
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
							scope: { name: "my-instrumentation" },
							spans: [
								{
									traceId,
									spanId: "abc123def456",
									parentSpanId: "parent123",
									name: "HTTP GET /api/users",
									startTimeUnixNano: "1766927492260000000",
									endTimeUnixNano: "1766927492300000000",
									status: { code: 1 },
								},
							],
						},
					],
				},
			],
		};

		const otlpResponse = await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(otlpPayload),
			}),
		);

		expect(otlpResponse.status).toBe(200);

		// Step 2: PUT test.json to /otel-playwright-reporter/test.json
		const testJson = {
			name: "should complete successfully",
			describes: ["User API", "GET endpoint"],
			file: "tests/api.spec.ts",
			line: 42,
			status: "passed",
			traceId,
			startTimeUnixNano: "1766927492000000000",
			endTimeUnixNano: "1766927493000000000",
		};

		const testJsonResponse = await app.fetch(
			new Request("http://localhost/otel-playwright-reporter/test.json", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"X-Trace-Id": traceId,
				},
				body: JSON.stringify(testJson),
			}),
		);

		expect(testJsonResponse.status).toBe(200);

		// Step 3: GET test.json back via viewer API
		const getTestJsonResponse = await app.fetch(
			new Request(`http://localhost/otel-trace-viewer/${traceId}/test.json`, {
				method: "GET",
			}),
		);

		expect(getTestJsonResponse.status).toBe(200);
		const retrievedTestJson = await getTestJsonResponse.json();
		expect(retrievedTestJson).toEqual(testJson);

		// Step 4: GET OTLP data back via viewer API
		// First, list available OTLP files
		const listOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol`,
				{
					method: "GET",
				},
			),
		);

		expect(listOtlpResponse.status).toBe(200);
		const otlpFiles = await listOtlpResponse.json();
		expect(otlpFiles).toEqual({
			jsonFiles: ["backend-api-abc123def456.json"],
		});

		// Then, get the specific OTLP file
		const getOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol/backend-api-abc123def456.json`,
				{
					method: "GET",
				},
			),
		);

		expect(getOtlpResponse.status).toBe(200);
		const retrievedOtlp = await getOtlpResponse.json();
		expect(retrievedOtlp).toEqual(otlpPayload);
	});
});
