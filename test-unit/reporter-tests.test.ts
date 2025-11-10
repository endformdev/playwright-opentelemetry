import type {
	FullConfig,
	FullResult,
	Suite,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";
import { beforeEach, describe, expect, test, vi } from "vitest";
import PlaywrightOpentelemetryReporter from "../src";
import {
	ATTR_CODE_FILE_PATH,
	ATTR_CODE_LINE_NUMBER,
	ATTR_TEST_CASE_NAME,
	ATTR_TEST_CASE_RESULT_STATUS,
} from "../src/otel-attributes";
import type { PlaywrightOpentelemetryReporterOptions } from "../src/reporter";

// Mock the sender module
vi.mock("../src/sender", () => ({
	sendSpans: vi.fn(),
}));

import { TEST_SPAN_NAME } from "../src/reporter-attributes";
// Import the mocked function
import { sendSpans } from "../src/sender";

const defaultOptions: PlaywrightOpentelemetryReporterOptions = {
	tracesEndpoint: "http://localhost:4317/v1/traces",
};

describe("PlaywrightOpentelemetryReporter - Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("sends a span for a test that ran", () => {
		// Create the reporter
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

		// Create a mock config
		const mockConfig: Partial<FullConfig> = {
			rootDir: "/Users/test/project/test-e2e",
			version: "1.56.1",
		};

		// Create a mock test case
		const mockTest: Partial<TestCase> = {
			title: "example test",
			titlePath: () => ["", "chromium", "example.spec.ts", "example test"],
			expectedStatus: "passed",
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
					name: TEST_SPAN_NAME,
					startTime: new Date("2025-11-06T10:00:00.000Z"),
					endTime: new Date("2025-11-06T10:00:01.500Z"),
					attributes: {
						[ATTR_TEST_CASE_NAME]: "example test",
						[ATTR_TEST_CASE_RESULT_STATUS]: "passed",
						[ATTR_CODE_FILE_PATH]: "example.spec.ts",
						[ATTR_CODE_LINE_NUMBER]: 3,
					},
					status: { code: 1 }, // OK - status matches expected
					traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
					spanId: expect.stringMatching(/^[0-9a-f]{16}$/),
				}),
			]),
			expect.objectContaining({
				...defaultOptions,
				playwrightVersion: "1.56.1",
			}),
		);
	});

	test("handles test without location information", () => {
		// Create the reporter
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

		// Create a mock config
		const mockConfig: Partial<FullConfig> = {
			rootDir: "/Users/test/project/test-e2e",
			version: "1.56.1",
		};

		// Create a mock test case without location
		const mockTest: Partial<TestCase> = {
			title: "test without location",
			titlePath: () => [
				"",
				"chromium",
				"test.spec.ts",
				"test without location",
			],
			expectedStatus: "passed",
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
					name: TEST_SPAN_NAME,
					attributes: expect.not.objectContaining({
						[ATTR_CODE_FILE_PATH]: expect.anything(),
						[ATTR_CODE_LINE_NUMBER]: expect.anything(),
					}),
				}),
			]),
			expect.objectContaining({
				...defaultOptions,
				playwrightVersion: "1.56.1",
			}),
		);
	});

	test("calculates relative path correctly for nested directories", () => {
		// Create the reporter
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

		// Create a mock config
		const mockConfig: Partial<FullConfig> = {
			rootDir: "/Users/test/project/test-e2e",
			version: "1.56.1",
		};

		// Create a mock test case in a subdirectory
		const mockTest: Partial<TestCase> = {
			title: "nested test",
			titlePath: () => ["", "chromium", "nested.spec.ts", "nested test"],
			expectedStatus: "passed",
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
		expect(sendSpans).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					name: TEST_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_CASE_NAME]: "nested test",
						[ATTR_TEST_CASE_RESULT_STATUS]: "passed",
						[ATTR_CODE_FILE_PATH]: "sub/dir/nested.spec.ts",
						[ATTR_CODE_LINE_NUMBER]: 10,
					}),
				}),
			]),
			expect.objectContaining({
				...defaultOptions,
				playwrightVersion: "1.56.1",
			}),
		);
	});

	test("includes describe blocks in test case name", () => {
		// Create the reporter
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

		// Create a mock config
		const mockConfig: Partial<FullConfig> = {
			rootDir: "/Users/test/project/test-e2e",
			version: "1.56.1",
		};

		// Create a mock test case with describe blocks
		const mockTest: Partial<TestCase> = {
			title: "get started link",
			titlePath: () => [
				"",
				"chromium",
				"example.spec.ts",
				"described tests",
				"get started link",
			],
			expectedStatus: "passed",
			location: {
				file: "/Users/test/project/test-e2e/example.spec.ts",
				line: 11,
				column: 1,
			},
		};

		// Create a mock test result
		const mockResult: Partial<TestResult> = {
			status: "passed",
			startTime: new Date("2025-11-06T10:00:00.000Z"),
			duration: 1500,
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
					name: TEST_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_CASE_NAME]: "described tests > get started link",
						[ATTR_TEST_CASE_RESULT_STATUS]: "passed",
						[ATTR_CODE_FILE_PATH]: "example.spec.ts",
						[ATTR_CODE_LINE_NUMBER]: 11,
					}),
				}),
			]),
			expect.objectContaining({
				...defaultOptions,
				playwrightVersion: "1.56.1",
			}),
		);
	});

	test("handles nested describe blocks in test case name", () => {
		// Create the reporter
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

		// Create a mock config
		const mockConfig: Partial<FullConfig> = {
			rootDir: "/Users/test/project/test-e2e",
			version: "1.56.1",
		};

		// Create a mock test case with multiple nested describe blocks
		const mockTest: Partial<TestCase> = {
			title: "should work correctly",
			titlePath: () => [
				"",
				"chromium",
				"feature.spec.ts",
				"Feature A",
				"Scenario 1",
				"Case B",
				"should work correctly",
			],
			expectedStatus: "passed",
			location: {
				file: "/Users/test/project/test-e2e/feature.spec.ts",
				line: 20,
				column: 1,
			},
		};

		// Create a mock test result
		const mockResult: Partial<TestResult> = {
			status: "passed",
			startTime: new Date("2025-11-06T10:00:00.000Z"),
			duration: 2000,
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
					name: TEST_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_CASE_NAME]:
							"Feature A > Scenario 1 > Case B > should work correctly",
						[ATTR_TEST_CASE_RESULT_STATUS]: "passed",
						[ATTR_CODE_FILE_PATH]: "feature.spec.ts",
						[ATTR_CODE_LINE_NUMBER]: 20,
					}),
				}),
			]),
			expect.objectContaining({
				...defaultOptions,
				playwrightVersion: "1.56.1",
			}),
		);
	});

	test("handles failed test status when expected to pass", () => {
		// Create the reporter
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

		// Create a mock config
		const mockConfig: Partial<FullConfig> = {
			rootDir: "/Users/test/project/test-e2e",
			version: "1.56.1",
		};

		// Create a mock test case expected to pass
		const mockTest: Partial<TestCase> = {
			title: "failing test",
			titlePath: () => ["", "chromium", "test.spec.ts", "failing test"],
			expectedStatus: "passed",
			location: {
				file: "/Users/test/project/test-e2e/test.spec.ts",
				line: 5,
				column: 1,
			},
		};

		// Create a mock test result with failed status
		const mockResult: Partial<TestResult> = {
			status: "failed",
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
					name: TEST_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_CASE_NAME]: "failing test",
						[ATTR_TEST_CASE_RESULT_STATUS]: "failed",
						[ATTR_CODE_FILE_PATH]: "test.spec.ts",
						[ATTR_CODE_LINE_NUMBER]: 5,
					}),
					status: { code: 2 }, // ERROR - status doesn't match expected
				}),
			]),
			expect.objectContaining({
				...defaultOptions,
				playwrightVersion: "1.56.1",
			}),
		);
	});

	test("handles expected failure correctly", () => {
		// Create the reporter
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

		// Create a mock config
		const mockConfig: Partial<FullConfig> = {
			rootDir: "/Users/test/project/test-e2e",
			version: "1.56.1",
		};

		// Create a mock test case expected to fail
		const mockTest: Partial<TestCase> = {
			title: "expected to fail",
			titlePath: () => ["", "chromium", "test.spec.ts", "expected to fail"],
			expectedStatus: "failed",
			location: {
				file: "/Users/test/project/test-e2e/test.spec.ts",
				line: 10,
				column: 1,
			},
		};

		// Create a mock test result with failed status
		const mockResult: Partial<TestResult> = {
			status: "failed",
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
					name: TEST_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_CASE_NAME]: "expected to fail",
						[ATTR_TEST_CASE_RESULT_STATUS]: "failed",
						[ATTR_CODE_FILE_PATH]: "test.spec.ts",
						[ATTR_CODE_LINE_NUMBER]: 10,
					}),
					status: { code: 1 }, // OK - status matches expected
				}),
			]),
			expect.objectContaining({
				...defaultOptions,
				playwrightVersion: "1.56.1",
			}),
		);
	});
});
