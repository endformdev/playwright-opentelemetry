import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ATTR_TEST_STEP_CATEGORY,
	ATTR_TEST_STEP_NAME,
	ATTR_TEST_STEP_TITLE,
	TEST_SPAN_NAME,
	TEST_STEP_SPAN_NAME,
} from "../src/reporter/reporter-attributes";
import { runReporterTest } from "./reporter-harness";

// Mock the sender module
vi.mock("../src/reporter/sender", () => ({
	sendSpans: vi.fn(),
}));

// Import the mocked function
import { sendSpans } from "../src/reporter/sender";

/**
 * OpenTelemetry Semantic Conventions for HTTP Client Spans
 * @see https://opentelemetry.io/docs/specs/semconv/http/http-spans/
 */

// Span name follows HTTP client span convention: "HTTP {method}" or "{method}"
const HTTP_CLIENT_SPAN_NAME = "HTTP GET" as const;

// Required attributes for HTTP client spans
const ATTR_HTTP_REQUEST_METHOD = "http.request.method" as const;
const ATTR_SERVER_ADDRESS = "server.address" as const;
const ATTR_SERVER_PORT = "server.port" as const;
const ATTR_URL_FULL = "url.full" as const;

// Conditionally required attributes
const ATTR_HTTP_RESPONSE_STATUS_CODE = "http.response.status_code" as const;
const ATTR_ERROR_TYPE = "error.type" as const;

// OpenTelemetry SpanKind values (from @opentelemetry/api)
// @see https://opentelemetry.io/docs/specs/otel/trace/api/#spankind
const SPAN_KIND_CLIENT = 3;

// OpenTelemetry SpanStatusCode values (from @opentelemetry/api)
// @see https://opentelemetry.io/docs/specs/otel/trace/api/#set-status
const SPAN_STATUS_CODE_UNSET = 0;
const SPAN_STATUS_CODE_ERROR = 2;

describe("PlaywrightOpentelemetryReporter - Fixture Integration (HTTP Client Spans)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates an HTTP client span as child of step when fixture propagator is called", async () => {
		const networkStartTime = new Date("2025-11-06T10:00:00.200Z");
		const networkDuration = 150;
		const networkEndTime = new Date(
			networkStartTime.getTime() + networkDuration,
		);

		await runReporterTest({
			test: {
				title: "test with network request in step",
				titlePath: [
					"",
					"chromium",
					"network.spec.ts",
					"test with network request in step",
				],
				location: {
					file: "/Users/test/project/test-e2e/network.spec.ts",
					line: 5,
				},
			},
			result: {
				steps: [
					{
						title: "Navigate to page",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.100Z"),
						duration: 500,
						location: {
							file: "/Users/test/project/test-e2e/network.spec.ts",
							line: 10,
						},
						networkActions: [
							{
								method: "GET",
								url: "https://api.example.com:443/users",
								serverAddress: "api.example.com",
								serverPort: 443,
								statusCode: 200,
								startTime: networkStartTime,
								duration: networkDuration,
							},
						],
					},
				],
			},
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);

		// Should have test span, step span, and HTTP client span
		expect(sendSpans).toHaveBeenCalledWith(
			expect.arrayContaining([
				// Test span
				expect.objectContaining({
					name: TEST_SPAN_NAME,
				}),
				// Step span
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "Navigate to page",
						[ATTR_TEST_STEP_TITLE]: "Navigate to page",
						[ATTR_TEST_STEP_CATEGORY]: "test.step",
					}),
				}),
				// HTTP client span - follows OpenTelemetry semantic conventions
				expect.objectContaining({
					name: HTTP_CLIENT_SPAN_NAME,
					kind: SPAN_KIND_CLIENT,
					// Timing comes directly from Playwright's timing() data
					startTime: networkStartTime,
					endTime: networkEndTime,
					// Span status MUST be left unset for 2xx responses
					status: { code: SPAN_STATUS_CODE_UNSET },
					attributes: expect.objectContaining({
						// Required attributes
						[ATTR_HTTP_REQUEST_METHOD]: "GET",
						[ATTR_SERVER_ADDRESS]: "api.example.com",
						[ATTR_SERVER_PORT]: 443,
						[ATTR_URL_FULL]: "https://api.example.com:443/users",
						// Conditionally required: status code if response received
						[ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
					}),
				}),
			]),
			expect.any(Object),
		);

		// Verify the HTTP client span has the step span as its parent
		const spans = (sendSpans as ReturnType<typeof vi.fn>).mock.calls[0][0];
		const stepSpan = spans.find(
			(s: { name: string }) => s.name === TEST_STEP_SPAN_NAME,
		);
		const httpSpan = spans.find(
			(s: { name: string }) => s.name === HTTP_CLIENT_SPAN_NAME,
		);

		expect(stepSpan).toBeDefined();
		expect(httpSpan).toBeDefined();
		expect(httpSpan.parentSpanId).toBe(stepSpan.spanId);
	});

	it("sets span status to Error for 4xx responses (CLIENT span kind)", async () => {
		const networkStartTime = new Date("2025-11-06T10:00:00.200Z");
		const networkDuration = 50;
		const networkEndTime = new Date(
			networkStartTime.getTime() + networkDuration,
		);

		await runReporterTest({
			test: {
				title: "test with 404 response",
				titlePath: [
					"",
					"chromium",
					"network.spec.ts",
					"test with 404 response",
				],
				location: {
					file: "/Users/test/project/test-e2e/network.spec.ts",
					line: 5,
				},
			},
			result: {
				steps: [
					{
						title: "Fetch missing resource",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.100Z"),
						duration: 500,
						networkActions: [
							{
								method: "GET",
								url: "https://api.example.com/missing",
								serverAddress: "api.example.com",
								serverPort: 443,
								statusCode: 404,
								startTime: networkStartTime,
								duration: networkDuration,
							},
						],
					},
				],
			},
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);

		// For HTTP status codes in the 4xx range, span status SHOULD be set to Error
		// for SpanKind.CLIENT
		expect(sendSpans).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					name: "HTTP GET",
					kind: SPAN_KIND_CLIENT,
					// Timing comes directly from Playwright's timing() data
					startTime: networkStartTime,
					endTime: networkEndTime,
					status: { code: SPAN_STATUS_CODE_ERROR },
					attributes: expect.objectContaining({
						[ATTR_HTTP_REQUEST_METHOD]: "GET",
						[ATTR_HTTP_RESPONSE_STATUS_CODE]: 404,
						// error.type SHOULD be set to the status code number (as string)
						[ATTR_ERROR_TYPE]: "404",
					}),
				}),
			]),
			expect.any(Object),
		);
	});
});
