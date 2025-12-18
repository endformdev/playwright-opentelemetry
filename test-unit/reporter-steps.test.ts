import type {
	FullConfig,
	FullResult,
	Suite,
	TestCase,
	TestResult,
	TestStep,
} from "@playwright/test/reporter";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { PlaywrightOpentelemetryReporterOptions } from "../src/reporter";
import PlaywrightOpentelemetryReporter from "../src/reporter";
import {
	ATTR_CODE_FILE_PATH,
	ATTR_CODE_LINE_NUMBER,
	ATTR_TEST_CASE_TITLE,
} from "../src/reporter/otel-attributes";

// Mock the sender module
vi.mock("../src/reporter/sender", () => ({
	sendSpans: vi.fn(),
}));

import {
	ATTR_TEST_STEP_CATEGORY,
	ATTR_TEST_STEP_NAME,
	ATTR_TEST_STEP_TITLE,
	TEST_SPAN_NAME,
	TEST_STEP_SPAN_NAME,
} from "../src/reporter/reporter-attributes";
// Import the mocked function
import { sendSpans } from "../src/reporter/sender";

const defaultOptions: PlaywrightOpentelemetryReporterOptions = {
	otlpEndpoint: "http://localhost:4317/v1/traces",
	debug: true,
};

describe("PlaywrightOpentelemetryReporter - Test Steps", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("creates a span for a test with a single step", () => {
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

		const mockConfig: Partial<FullConfig> = {
			rootDir: "/Users/test/project/test-e2e",
			version: "1.56.1",
		};

		const mockStep: Partial<TestStep> = {
			title: "Login step",
			category: "test.step",
			startTime: new Date("2025-11-06T10:00:00.100Z"),
			duration: 500,
			steps: [],
			error: undefined,
			location: {
				file: "/Users/test/project/test-e2e/auth.spec.ts",
				line: 10,
				column: 3,
			},
		};

		const mockTest: Partial<TestCase> = {
			title: "should login",
			titlePath: () => ["", "chromium", "auth.spec.ts", "should login"],
			expectedStatus: "passed",
			location: {
				file: "/Users/test/project/test-e2e/auth.spec.ts",
				line: 8,
				column: 1,
			},
		};

		const mockResult: Partial<TestResult> = {
			status: "passed",
			startTime: new Date("2025-11-06T10:00:00.000Z"),
			duration: 1000,
			steps: [mockStep as TestStep],
		};

		reporter.onBegin(mockConfig as FullConfig, {} as Suite);
		reporter.onTestBegin(mockTest as TestCase);
		reporter.onTestEnd(mockTest as TestCase, mockResult as TestResult);
		reporter.onEnd({} as FullResult);

		expect(sendSpans).toHaveBeenCalledTimes(1);
		expect(sendSpans).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					name: TEST_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_CASE_TITLE]: "should login",
					}),
				}),
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					startTime: new Date("2025-11-06T10:00:00.100Z"),
					endTime: new Date("2025-11-06T10:00:00.600Z"),
					attributes: expect.objectContaining({
						[ATTR_CODE_FILE_PATH]: "auth.spec.ts",
						[ATTR_CODE_LINE_NUMBER]: 10,
						[ATTR_TEST_STEP_NAME]: "Login step",
						[ATTR_TEST_STEP_TITLE]: "Login step",
						[ATTR_TEST_STEP_CATEGORY]: "test.step",
					}),
				}),
			]),
			expect.any(Object),
		);
	});

	test("creates nested spans for nested steps", () => {
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

		const mockConfig: Partial<FullConfig> = {
			rootDir: "/Users/test/project/test-e2e",
			version: "1.56.1",
		};

		const mockSubStep: Partial<TestStep> = {
			title: "Fill username",
			category: "test.step",
			startTime: new Date("2025-11-06T10:00:00.200Z"),
			duration: 200,
			steps: [],
			error: undefined,
			location: {
				file: "/Users/test/project/test-e2e/auth.spec.ts",
				line: 12,
				column: 5,
			},
		};

		const mockParentStep: Partial<TestStep> = {
			title: "Login flow",
			category: "test.step",
			startTime: new Date("2025-11-06T10:00:00.100Z"),
			duration: 500,
			steps: [mockSubStep as TestStep],
			error: undefined,
			location: {
				file: "/Users/test/project/test-e2e/auth.spec.ts",
				line: 11,
				column: 3,
			},
		};

		const mockTest: Partial<TestCase> = {
			title: "should login",
			titlePath: () => ["", "chromium", "auth.spec.ts", "should login"],
			expectedStatus: "passed",
			location: {
				file: "/Users/test/project/test-e2e/auth.spec.ts",
				line: 8,
				column: 1,
			},
		};

		const mockResult: Partial<TestResult> = {
			status: "passed",
			startTime: new Date("2025-11-06T10:00:00.000Z"),
			duration: 1000,
			steps: [mockParentStep as TestStep],
		};

		reporter.onBegin(mockConfig as FullConfig, {} as Suite);
		reporter.onTestBegin(mockTest as TestCase);
		reporter.onTestEnd(mockTest as TestCase, mockResult as TestResult);
		reporter.onEnd({} as FullResult);

		expect(sendSpans).toHaveBeenCalledTimes(1);
		expect(sendSpans).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					name: TEST_SPAN_NAME,
				}),
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "Login flow",
						[ATTR_TEST_STEP_TITLE]: "Login flow",
					}),
				}),
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "Login flow > Fill username",
						[ATTR_TEST_STEP_TITLE]: "Fill username",
					}),
				}),
			]),
			expect.any(Object),
		);
	});

	test("creates spans for multiple sibling steps", () => {
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

		const mockConfig: Partial<FullConfig> = {
			rootDir: "/Users/test/project/test-e2e",
			version: "1.56.1",
		};

		const mockStep1: Partial<TestStep> = {
			title: "Step 1",
			category: "test.step",
			startTime: new Date("2025-11-06T10:00:00.100Z"),
			duration: 200,
			steps: [],
			error: undefined,
		};

		const mockStep2: Partial<TestStep> = {
			title: "Step 2",
			category: "test.step",
			startTime: new Date("2025-11-06T10:00:00.300Z"),
			duration: 300,
			steps: [],
			error: undefined,
		};

		const mockStep3: Partial<TestStep> = {
			title: "Step 3",
			category: "test.step",
			startTime: new Date("2025-11-06T10:00:00.600Z"),
			duration: 100,
			steps: [],
			error: undefined,
		};

		const mockTest: Partial<TestCase> = {
			title: "test with multiple steps",
			titlePath: () => [
				"",
				"chromium",
				"test.spec.ts",
				"test with multiple steps",
			],
			expectedStatus: "passed",
			location: {
				file: "/Users/test/project/test-e2e/test.spec.ts",
				line: 5,
				column: 1,
			},
		};

		const mockResult: Partial<TestResult> = {
			status: "passed",
			startTime: new Date("2025-11-06T10:00:00.000Z"),
			duration: 1000,
			steps: [
				mockStep1 as TestStep,
				mockStep2 as TestStep,
				mockStep3 as TestStep,
			],
		};

		reporter.onBegin(mockConfig as FullConfig, {} as Suite);
		reporter.onTestBegin(mockTest as TestCase);
		reporter.onTestEnd(mockTest as TestCase, mockResult as TestResult);
		reporter.onEnd({} as FullResult);

		expect(sendSpans).toHaveBeenCalledTimes(1);
		expect(sendSpans).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					name: TEST_SPAN_NAME,
				}),
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "Step 1",
					}),
				}),
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "Step 2",
					}),
				}),
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "Step 3",
					}),
				}),
			]),
			expect.any(Object),
		);
	});

	test("creates deeply nested spans (3 levels)", () => {
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

		const mockConfig: Partial<FullConfig> = {
			rootDir: "/Users/test/project/test-e2e",
			version: "1.56.1",
		};

		const mockGrandchildStep: Partial<TestStep> = {
			title: "Level 3",
			category: "test.step",
			startTime: new Date("2025-11-06T10:00:00.300Z"),
			duration: 100,
			steps: [],
			error: undefined,
		};

		const mockChildStep: Partial<TestStep> = {
			title: "Level 2",
			category: "test.step",
			startTime: new Date("2025-11-06T10:00:00.200Z"),
			duration: 300,
			steps: [mockGrandchildStep as TestStep],
			error: undefined,
		};

		const mockParentStep: Partial<TestStep> = {
			title: "Level 1",
			category: "test.step",
			startTime: new Date("2025-11-06T10:00:00.100Z"),
			duration: 500,
			steps: [mockChildStep as TestStep],
			error: undefined,
		};

		const mockTest: Partial<TestCase> = {
			title: "deeply nested test",
			titlePath: () => ["", "chromium", "test.spec.ts", "deeply nested test"],
			expectedStatus: "passed",
			location: {
				file: "/Users/test/project/test-e2e/test.spec.ts",
				line: 5,
				column: 1,
			},
		};

		const mockResult: Partial<TestResult> = {
			status: "passed",
			startTime: new Date("2025-11-06T10:00:00.000Z"),
			duration: 1000,
			steps: [mockParentStep as TestStep],
		};

		reporter.onBegin(mockConfig as FullConfig, {} as Suite);
		reporter.onTestBegin(mockTest as TestCase);
		reporter.onTestEnd(mockTest as TestCase, mockResult as TestResult);
		reporter.onEnd({} as FullResult);

		expect(sendSpans).toHaveBeenCalledTimes(1);
		expect(sendSpans).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					name: TEST_SPAN_NAME,
				}),
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "Level 1",
						[ATTR_TEST_STEP_TITLE]: "Level 1",
					}),
				}),
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "Level 1 > Level 2",
						[ATTR_TEST_STEP_TITLE]: "Level 2",
					}),
				}),
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "Level 1 > Level 2 > Level 3",
						[ATTR_TEST_STEP_TITLE]: "Level 3",
					}),
				}),
			]),
			expect.any(Object),
		);
	});

	test("handles step with error correctly", () => {
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

		const mockConfig: Partial<FullConfig> = {
			rootDir: "/Users/test/project/test-e2e",
			version: "1.56.1",
		};

		const mockStep: Partial<TestStep> = {
			title: "Failing step",
			category: "test.step",
			startTime: new Date("2025-11-06T10:00:00.100Z"),
			duration: 200,
			steps: [],
			error: {
				message: "Expected element to be visible",
				stack: "Error: Expected element to be visible\n    at ...",
			},
			location: {
				file: "/Users/test/project/test-e2e/test.spec.ts",
				line: 10,
				column: 3,
			},
		};

		const mockTest: Partial<TestCase> = {
			title: "test with failing step",
			titlePath: () => [
				"",
				"chromium",
				"test.spec.ts",
				"test with failing step",
			],
			expectedStatus: "passed",
			location: {
				file: "/Users/test/project/test-e2e/test.spec.ts",
				line: 8,
				column: 1,
			},
		};

		const mockResult: Partial<TestResult> = {
			status: "failed",
			startTime: new Date("2025-11-06T10:00:00.000Z"),
			duration: 500,
			steps: [mockStep as TestStep],
		};

		reporter.onBegin(mockConfig as FullConfig, {} as Suite);
		reporter.onTestBegin(mockTest as TestCase);
		reporter.onTestEnd(mockTest as TestCase, mockResult as TestResult);
		reporter.onEnd({} as FullResult);

		expect(sendSpans).toHaveBeenCalledTimes(1);
		expect(sendSpans).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "Failing step",
					}),
					status: { code: 2 }, // ERROR status because it has an error
				}),
			]),
			expect.any(Object),
		);
	});

	test("handles steps without location information", () => {
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

		const mockConfig: Partial<FullConfig> = {
			rootDir: "/Users/test/project/test-e2e",
			version: "1.56.1",
		};

		const mockStep: Partial<TestStep> = {
			title: "Step without location",
			category: "test.step",
			startTime: new Date("2025-11-06T10:00:00.100Z"),
			duration: 200,
			steps: [],
			error: undefined,
			location: undefined,
		};

		const mockTest: Partial<TestCase> = {
			title: "test",
			titlePath: () => ["", "chromium", "test.spec.ts", "test"],
			expectedStatus: "passed",
			location: {
				file: "/Users/test/project/test-e2e/test.spec.ts",
				line: 5,
				column: 1,
			},
		};

		const mockResult: Partial<TestResult> = {
			status: "passed",
			startTime: new Date("2025-11-06T10:00:00.000Z"),
			duration: 500,
			steps: [mockStep as TestStep],
		};

		reporter.onBegin(mockConfig as FullConfig, {} as Suite);
		reporter.onTestBegin(mockTest as TestCase);
		reporter.onTestEnd(mockTest as TestCase, mockResult as TestResult);
		reporter.onEnd({} as FullResult);

		expect(sendSpans).toHaveBeenCalledTimes(1);
		expect(sendSpans).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "Step without location",
						[ATTR_TEST_STEP_TITLE]: "Step without location",
						[ATTR_TEST_STEP_CATEGORY]: "test.step",
					}),
				}),
			]),
			expect.any(Object),
		);
	});

	test("handles test with no steps", () => {
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

		const mockConfig: Partial<FullConfig> = {
			rootDir: "/Users/test/project/test-e2e",
			version: "1.56.1",
		};

		const mockTest: Partial<TestCase> = {
			title: "test without steps",
			titlePath: () => ["", "chromium", "test.spec.ts", "test without steps"],
			expectedStatus: "passed",
			location: {
				file: "/Users/test/project/test-e2e/test.spec.ts",
				line: 5,
				column: 1,
			},
		};

		const mockResult: Partial<TestResult> = {
			status: "passed",
			startTime: new Date("2025-11-06T10:00:00.000Z"),
			duration: 500,
			steps: [],
		};

		reporter.onBegin(mockConfig as FullConfig, {} as Suite);
		reporter.onTestBegin(mockTest as TestCase);
		reporter.onTestEnd(mockTest as TestCase, mockResult as TestResult);
		reporter.onEnd({} as FullResult);

		expect(sendSpans).toHaveBeenCalledTimes(1);
		expect(sendSpans).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					name: TEST_SPAN_NAME,
				}),
			],
			expect.any(Object),
		);
	});

	test("includes all step categories", () => {
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

		const mockConfig: Partial<FullConfig> = {
			rootDir: "/Users/test/project/test-e2e",
			version: "1.56.1",
		};

		const mockTestStep: Partial<TestStep> = {
			title: "User step",
			category: "test.step",
			startTime: new Date("2025-11-06T10:00:00.100Z"),
			duration: 200,
			steps: [],
			error: undefined,
		};

		const mockExpectStep: Partial<TestStep> = {
			title: "expect.toBeVisible",
			category: "expect",
			startTime: new Date("2025-11-06T10:00:00.300Z"),
			duration: 50,
			steps: [],
			error: undefined,
		};

		const mockApiStep: Partial<TestStep> = {
			title: "page.click",
			category: "pw:api",
			startTime: new Date("2025-11-06T10:00:00.350Z"),
			duration: 100,
			steps: [],
			error: undefined,
		};

		const mockTest: Partial<TestCase> = {
			title: "test with mixed step categories",
			titlePath: () => [
				"",
				"chromium",
				"test.spec.ts",
				"test with mixed step categories",
			],
			expectedStatus: "passed",
			location: {
				file: "/Users/test/project/test-e2e/test.spec.ts",
				line: 5,
				column: 1,
			},
		};

		const mockResult: Partial<TestResult> = {
			status: "passed",
			startTime: new Date("2025-11-06T10:00:00.000Z"),
			duration: 500,
			steps: [
				mockTestStep as TestStep,
				mockExpectStep as TestStep,
				mockApiStep as TestStep,
			],
		};

		reporter.onBegin(mockConfig as FullConfig, {} as Suite);
		reporter.onTestBegin(mockTest as TestCase);
		reporter.onTestEnd(mockTest as TestCase, mockResult as TestResult);
		reporter.onEnd({} as FullResult);

		expect(sendSpans).toHaveBeenCalledTimes(1);
		expect(sendSpans).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					name: TEST_SPAN_NAME,
				}),
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "User step",
						[ATTR_TEST_STEP_TITLE]: "User step",
						[ATTR_TEST_STEP_CATEGORY]: "test.step",
					}),
				}),
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "expect.toBeVisible",
						[ATTR_TEST_STEP_TITLE]: "expect.toBeVisible",
						[ATTR_TEST_STEP_CATEGORY]: "expect",
					}),
				}),
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "page.click",
						[ATTR_TEST_STEP_TITLE]: "page.click",
						[ATTR_TEST_STEP_CATEGORY]: "pw:api",
					}),
				}),
			]),
			expect.any(Object),
		);
	});

	test("handles complex nested structure with mixed step types", () => {
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

		const mockConfig: Partial<FullConfig> = {
			rootDir: "/Users/test/project/test-e2e",
			version: "1.56.1",
		};

		// Nested structure:
		// Step 1 (test.step)
		//   -> SubStep 1.1 (test.step)
		//   -> SubStep 1.2 (expect)
		// Step 2 (test.step)

		const mockSubStep11: Partial<TestStep> = {
			title: "SubStep 1.1",
			category: "test.step",
			startTime: new Date("2025-11-06T10:00:00.150Z"),
			duration: 100,
			steps: [],
			error: undefined,
		};

		const mockSubStep12: Partial<TestStep> = {
			title: "expect.toBeVisible",
			category: "expect",
			startTime: new Date("2025-11-06T10:00:00.250Z"),
			duration: 50,
			steps: [],
			error: undefined,
		};

		const mockStep1: Partial<TestStep> = {
			title: "Step 1",
			category: "test.step",
			startTime: new Date("2025-11-06T10:00:00.100Z"),
			duration: 300,
			steps: [mockSubStep11 as TestStep, mockSubStep12 as TestStep],
			error: undefined,
		};

		const mockStep2: Partial<TestStep> = {
			title: "Step 2",
			category: "test.step",
			startTime: new Date("2025-11-06T10:00:00.400Z"),
			duration: 200,
			steps: [],
			error: undefined,
		};

		const mockTest: Partial<TestCase> = {
			title: "complex nested test",
			titlePath: () => ["", "chromium", "test.spec.ts", "complex nested test"],
			expectedStatus: "passed",
			location: {
				file: "/Users/test/project/test-e2e/test.spec.ts",
				line: 5,
				column: 1,
			},
		};

		const mockResult: Partial<TestResult> = {
			status: "passed",
			startTime: new Date("2025-11-06T10:00:00.000Z"),
			duration: 700,
			steps: [mockStep1 as TestStep, mockStep2 as TestStep],
		};

		reporter.onBegin(mockConfig as FullConfig, {} as Suite);
		reporter.onTestBegin(mockTest as TestCase);
		reporter.onTestEnd(mockTest as TestCase, mockResult as TestResult);
		reporter.onEnd({} as FullResult);

		expect(sendSpans).toHaveBeenCalledTimes(1);
		expect(sendSpans).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					name: TEST_SPAN_NAME,
				}),
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "Step 1",
						[ATTR_TEST_STEP_TITLE]: "Step 1",
					}),
				}),
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "Step 1 > SubStep 1.1",
						[ATTR_TEST_STEP_TITLE]: "SubStep 1.1",
						[ATTR_TEST_STEP_CATEGORY]: "test.step",
					}),
				}),
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "Step 1 > expect.toBeVisible",
						[ATTR_TEST_STEP_TITLE]: "expect.toBeVisible",
						[ATTR_TEST_STEP_CATEGORY]: "expect",
					}),
				}),
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "Step 2",
						[ATTR_TEST_STEP_TITLE]: "Step 2",
						[ATTR_TEST_STEP_CATEGORY]: "test.step",
					}),
				}),
			]),
			expect.any(Object),
		);
	});

	test("adds category attribute to step spans", () => {
		const reporter = new PlaywrightOpentelemetryReporter(defaultOptions);

		const mockConfig: Partial<FullConfig> = {
			rootDir: "/Users/test/project/test-e2e",
			version: "1.56.1",
		};

		const mockStep: Partial<TestStep> = {
			title: "User defined step",
			category: "test.step",
			startTime: new Date("2025-11-06T10:00:00.100Z"),
			duration: 200,
			steps: [],
			error: undefined,
		};

		const mockTest: Partial<TestCase> = {
			title: "test",
			titlePath: () => ["", "chromium", "test.spec.ts", "test"],
			expectedStatus: "passed",
			location: {
				file: "/Users/test/project/test-e2e/test.spec.ts",
				line: 5,
				column: 1,
			},
		};

		const mockResult: Partial<TestResult> = {
			status: "passed",
			startTime: new Date("2025-11-06T10:00:00.000Z"),
			duration: 500,
			steps: [mockStep as TestStep],
		};

		reporter.onBegin(mockConfig as FullConfig, {} as Suite);
		reporter.onTestBegin(mockTest as TestCase);
		reporter.onTestEnd(mockTest as TestCase, mockResult as TestResult);
		reporter.onEnd({} as FullResult);

		expect(sendSpans).toHaveBeenCalledTimes(1);
		expect(sendSpans).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "User defined step",
						[ATTR_TEST_STEP_TITLE]: "User defined step",
						[ATTR_TEST_STEP_CATEGORY]: "test.step",
					}),
				}),
			]),
			expect.any(Object),
		);
	});
});
