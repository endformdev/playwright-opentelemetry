import type {
	FullConfig,
	FullResult,
	Suite,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";
import { beforeEach, describe, expect, test, vi } from "vitest";
import PlaywrightOpentelemetryReporter from "../src";
import { ATTR_CODE_FILE_PATH, ATTR_CODE_LINE_NUMBER } from "../src/attributes";
import type { PlaywrightOpentelemetryReporterOptions } from "../src/options";

// Mock the sender module
vi.mock("../src/sender", () => ({
	sendSpans: vi.fn(),
}));

// Import the mocked function
import { sendSpans } from "../src/sender";

const defaultOptions: PlaywrightOpentelemetryReporterOptions = {
	tracesEndpoint: "http://localhost:4317/v1/traces",
};

describe("PlaywrightOpentelemetryReporter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("sends a span for a test that ran", () => {
		// Create the reporter
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

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
						[ATTR_CODE_FILE_PATH]: "example.spec.ts",
						[ATTR_CODE_LINE_NUMBER]: 3,
					},
					status: { code: 1 }, // OK
					traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
					spanId: expect.stringMatching(/^[0-9a-f]{16}$/),
				}),
			]),
			defaultOptions,
		);
	});

	test("handles test without location information", () => {
		// Create the reporter
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

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
					attributes: expect.not.objectContaining({
						[ATTR_CODE_FILE_PATH]: expect.anything(),
						[ATTR_CODE_LINE_NUMBER]: expect.anything(),
					}),
				}),
			]),
			defaultOptions,
		);
	});

	test("calculates relative path correctly for nested directories", () => {
		// Create the reporter
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

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
		expect(sendSpans).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					name: "nested test",
					attributes: expect.objectContaining({
						"test.status": "passed",
						[ATTR_CODE_FILE_PATH]: "sub/dir/nested.spec.ts",
						[ATTR_CODE_LINE_NUMBER]: 10,
					}),
				}),
			]),
			defaultOptions,
		);
	});
});
