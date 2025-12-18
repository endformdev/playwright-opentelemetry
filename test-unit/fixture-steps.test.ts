import { beforeEach, describe, expect, test, vi } from "vitest";
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

// OpenTelemetry HTTP semantic conventions
const HTTP_CLIENT_SPAN_NAME = "HTTP GET" as const;
const ATTR_HTTP_REQUEST_METHOD = "http.request.method" as const;
const ATTR_URL_FULL = "url.full" as const;

describe("PlaywrightOpentelemetryReporter - Fixture Integration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("creates a network request span as child of step when fixture propagator is called", async () => {
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
								url: "https://api.example.com/users",
								startTime: new Date("2025-11-06T10:00:00.200Z"),
								duration: 150,
							},
						],
					},
				],
			},
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);

		// Should have test span, step span, and network request span
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
				// HTTP client span - should be child of the step (OpenTelemetry conventions)
				expect.objectContaining({
					name: HTTP_CLIENT_SPAN_NAME,
					// Timing is captured at actual request time
					startTime: expect.any(Date),
					endTime: expect.any(Date),
					attributes: expect.objectContaining({
						[ATTR_HTTP_REQUEST_METHOD]: "GET",
						[ATTR_URL_FULL]: "https://api.example.com/users",
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
});
