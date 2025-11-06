import type {
	FullConfig,
	FullResult,
	Suite,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";
import { expect, test, vi } from "vitest";
import {
	ATTR_CODE_COLUMN,
	ATTR_CODE_FILEPATH,
	ATTR_CODE_LINENO,
} from "../src/attributes";
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
		tracesEndpoint: "http://localhost:4317/v1/traces",
	});

	// Create a mock config
	const mockConfig: Partial<FullConfig> = {
		rootDir: "/Users/test/project/test-e2e",
	};

	// Create a mock test case
	const mockTest: Partial<TestCase> = {
		title: "example test",
		location: {
			file: "/Users/test/project/test-e2e/example.spec.ts",
			line: 3,
			column: 1,
		},
	};

	// Create a mock test result
	const mockResult: Partial<TestResult> = {
		status: "passed",
		startTime: new Date("2025-11-06T10:00:00.000Z"),
		duration: 1500, // 1.5 seconds
	};

	// Simulate Playwright events
	reporter.onBegin(mockConfig as FullConfig, {} as Suite);
	reporter.onTestBegin(mockTest as TestCase);
	reporter.onTestEnd(mockTest as TestCase, mockResult as TestResult);
	reporter.onEnd({} as FullResult);

	// Verify sendSpans was called
	expect(sendSpans).toHaveBeenCalledTimes(1);
	expect(sendSpans).toHaveBeenCalledWith(
		expect.arrayContaining([
			expect.objectContaining({
				name: "example test",
				startTime: new Date("2025-11-06T10:00:00.000Z"),
				endTime: new Date("2025-11-06T10:00:01.500Z"),
				attributes: {
					"test.status": "passed",
					[ATTR_CODE_FILEPATH]: "example.spec.ts",
					[ATTR_CODE_LINENO]: 3,
					[ATTR_CODE_COLUMN]: 1,
				},
				status: { code: 1 }, // OK
				traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
				spanId: expect.stringMatching(/^[0-9a-f]{16}$/),
			}),
		]),
		{
			tracesEndpoint: "http://localhost:4317/v1/traces",
		},
	);
});

test("handles test without location information", () => {
	// Clear any previous calls
	vi.clearAllMocks();

	// Create the reporter
	const reporter = new PlaywrightOpentelemetryReporter({
		tracesEndpoint: "http://localhost:4317/v1/traces",
	});

	// Create a mock config
	const mockConfig: Partial<FullConfig> = {
		rootDir: "/Users/test/project/test-e2e",
	};

	// Create a mock test case without location
	const mockTest: Partial<TestCase> = {
		title: "test without location",
		location: undefined,
	};

	// Create a mock test result
	const mockResult: Partial<TestResult> = {
		status: "passed",
		startTime: new Date("2025-11-06T10:00:00.000Z"),
		duration: 1000,
	};

	// Simulate Playwright events
	reporter.onBegin(mockConfig as FullConfig, {} as Suite);
	reporter.onTestBegin(mockTest as TestCase);
	reporter.onTestEnd(mockTest as TestCase, mockResult as TestResult);
	reporter.onEnd({} as FullResult);

	// Verify sendSpans was called
	expect(sendSpans).toHaveBeenCalledTimes(1);
	expect(sendSpans).toHaveBeenCalledWith(
		expect.arrayContaining([
			expect.objectContaining({
				name: "test without location",
				attributes: {
					"test.status": "passed",
					// No code attributes should be present
				},
			}),
		]),
		{
			tracesEndpoint: "http://localhost:4317/v1/traces",
		},
	);

	// Verify no code attributes are present
	const spans = (sendSpans as any).mock.calls[0][0];
	expect(spans[0].attributes).not.toHaveProperty(ATTR_CODE_FILEPATH);
	expect(spans[0].attributes).not.toHaveProperty(ATTR_CODE_LINENO);
	expect(spans[0].attributes).not.toHaveProperty(ATTR_CODE_COLUMN);
});

test("calculates relative path correctly for nested directories", () => {
	// Clear any previous calls
	vi.clearAllMocks();

	// Create the reporter
	const reporter = new PlaywrightOpentelemetryReporter({
		tracesEndpoint: "http://localhost:4317/v1/traces",
	});

	// Create a mock config
	const mockConfig: Partial<FullConfig> = {
		rootDir: "/Users/test/project/test-e2e",
	};

	// Create a mock test case in a subdirectory
	const mockTest: Partial<TestCase> = {
		title: "nested test",
		location: {
			file: "/Users/test/project/test-e2e/sub/dir/nested.spec.ts",
			line: 10,
			column: 5,
		},
	};

	// Create a mock test result
	const mockResult: Partial<TestResult> = {
		status: "passed",
		startTime: new Date("2025-11-06T10:00:00.000Z"),
		duration: 1000,
	};

	// Simulate Playwright events
	reporter.onBegin(mockConfig as FullConfig, {} as Suite);
	reporter.onTestBegin(mockTest as TestCase);
	reporter.onTestEnd(mockTest as TestCase, mockResult as TestResult);
	reporter.onEnd({} as FullResult);

	// Verify sendSpans was called
	expect(sendSpans).toHaveBeenCalledTimes(1);
	const spans = (sendSpans as any).mock.calls[0][0];
	expect(spans[0].attributes[ATTR_CODE_FILEPATH]).toBe("sub/dir/nested.spec.ts");
	expect(spans[0].attributes[ATTR_CODE_LINENO]).toBe(10);
	expect(spans[0].attributes[ATTR_CODE_COLUMN]).toBe(5);
});
