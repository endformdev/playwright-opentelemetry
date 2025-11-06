import type {
	FullResult,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";
import { expect, test, vi } from "vitest";
import PlaywrightOpentelemetryReporter from "../src";

// Mock the sender module
vi.mock("../src/sender", () => ({
	sendSpans: vi.fn(),
}));

// Import the mocked function
import { sendSpans } from "../src/sender";

test("sends a span for a test that ran", () => {
	// Clear any previous calls
	vi.clearAllMocks();

	// Create the reporter
	const reporter = new PlaywrightOpentelemetryReporter({
		opentelemetryEndpoint: "http://localhost:4317",
	});

	// Create a mock test case
	const mockTest: Partial<TestCase> = {
		title: "example test",
	};

	// Create a mock test result
	const mockResult: Partial<TestResult> = {
		status: "passed",
		startTime: new Date("2025-11-06T10:00:00.000Z"),
		duration: 1500, // 1.5 seconds
	};

	// Simulate Playwright events
	reporter.onTestBegin(mockTest as TestCase);
	reporter.onTestEnd(mockTest as TestCase, mockResult as TestResult);
	reporter.onEnd({} as FullResult);

	// Verify sendSpans was called
	expect(sendSpans).toHaveBeenCalledTimes(1);
	expect(sendSpans).toHaveBeenCalledWith(expect.any(Array));
	expect(sendSpans).toHaveBeenCalledWith(
		expect.arrayContaining([
			expect.objectContaining({
				name: "example test",
				kind: 1, // SPAN_KIND_INTERNAL
				startTimeUnixNano: "1762423200000000000",
				endTimeUnixNano: "1762423201500000000",
				attributes: [{ key: "test.status", value: { stringValue: "passed" } }],
				status: { code: 1 }, // OK
				traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
				spanId: expect.stringMatching(/^[0-9a-f]{16}$/),
			}),
		]),
	);
});
