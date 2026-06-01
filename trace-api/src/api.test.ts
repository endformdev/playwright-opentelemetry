import { describe, expect, it } from "vitest";
import { createTestHarness } from "./testHarness";

describe("Trace API integration", () => {
	it("should store OTLP test metadata, backend spans, and screenshots", async () => {
		const app = createTestHarness();

		const traceId = "7709187832dca84f02f413a312421586";

		const playwrightOtlpPayload = {
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
							scope: { name: "playwright-opentelemetry" },
							spans: [
								{
									traceId,
									spanId: "testspan0000001",
									name: "playwright.test",
									kind: 1,
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
										{
											key: "playwright.test.describes",
											value: {
												arrayValue: {
													values: [
														{ stringValue: "User API" },
														{ stringValue: "GET endpoint" },
													],
												},
											},
										},
										{
											key: "code.file.path",
											value: { stringValue: "tests/api.spec.ts" },
										},
										{
											key: "code.line.number",
											value: { intValue: 42 },
										},
									],
									status: { code: 1 },
								},
								{
									traceId,
									spanId: "stepspan00000001",
									parentSpanId: "testspan0000001",
									name: "playwright.test.step",
									kind: 1,
									startTimeUnixNano: "1766927492100000000",
									endTimeUnixNano: "1766927492200000000",
									attributes: [
										{
											key: "test.step.title",
											value: { stringValue: "load users" },
										},
									],
									status: { code: 1 },
								},
							],
						},
					],
				},
			],
		};

		const backendOtlpPayload = {
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
									kind: 2,
									startTimeUnixNano: "1766927492260000000",
									endTimeUnixNano: "1766927492300000000",
									attributes: [
										{
											key: "http.request.method",
											value: { stringValue: "GET" },
										},
										{
											key: "http.route",
											value: { stringValue: "/api/users" },
										},
									],
									status: { code: 1 },
								},
							],
						},
					],
				},
			],
		};

		const playwrightOtlpResponse = await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(playwrightOtlpPayload),
			}),
		);

		expect(playwrightOtlpResponse.status).toBe(200);

		const backendOtlpResponse = await app.fetch(
			new Request("http://localhost/v1/traces", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(backendOtlpPayload),
			}),
		);

		expect(backendOtlpResponse.status).toBe(200);

		const screenshotResponse = await app.fetch(
			new Request(
				"http://localhost/otel-playwright-reporter/screenshots/page@abc-1766927492500000000.jpeg",
				{
					method: "PUT",
					headers: {
						"Content-Type": "image/jpeg",
						"X-Trace-Id": traceId,
					},
					body: new TextEncoder().encode("fake screenshot").buffer,
				},
			),
		);

		expect(screenshotResponse.status).toBe(200);

		// Step 2: GET OTLP data back via viewer API.
		const listOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol`,
				{
					method: "GET",
				},
			),
		);

		expect(listOtlpResponse.status).toBe(200);
		const otlpFiles = (await listOtlpResponse.json()) as {
			jsonFiles: string[];
		};
		expect(otlpFiles).toEqual({
			jsonFiles: [
				"backend-api-abc123def456.json",
				"playwright-tests-testspan0000001.json",
			],
		});

		const getPlaywrightOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol/playwright-tests-testspan0000001.json`,
				{
					method: "GET",
				},
			),
		);

		expect(getPlaywrightOtlpResponse.status).toBe(200);
		const retrievedPlaywrightOtlp = await getPlaywrightOtlpResponse.json();
		expect(retrievedPlaywrightOtlp).toEqual(playwrightOtlpPayload);
		expect(
			retrievedPlaywrightOtlp.resourceSpans[0].scopeSpans[0].spans[0],
		).toMatchObject({
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
				expect.objectContaining({
					key: "code.file.path",
					value: { stringValue: "tests/api.spec.ts" },
				}),
			]),
		});

		const getBackendOtlpResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/opentelemetry-protocol/backend-api-abc123def456.json`,
				{
					method: "GET",
				},
			),
		);

		expect(getBackendOtlpResponse.status).toBe(200);
		const retrievedBackendOtlp = await getBackendOtlpResponse.json();
		expect(retrievedBackendOtlp).toEqual(backendOtlpPayload);

		const listScreenshotsResponse = await app.fetch(
			new Request(`http://localhost/otel-trace-viewer/${traceId}/screenshots`, {
				method: "GET",
			}),
		);

		expect(listScreenshotsResponse.status).toBe(200);
		expect(await listScreenshotsResponse.json()).toEqual({
			screenshots: [
				{
					file: "page@abc-1766927492500000000.jpeg",
					timestamp: 1766927492500000000,
				},
			],
		});

		const getScreenshotResponse = await app.fetch(
			new Request(
				`http://localhost/otel-trace-viewer/${traceId}/screenshots/page@abc-1766927492500000000.jpeg`,
				{
					method: "GET",
				},
			),
		);

		expect(getScreenshotResponse.status).toBe(200);
		expect(getScreenshotResponse.headers.get("content-type")).toBe(
			"image/jpeg",
		);
	});
});
