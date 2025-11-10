import type {
	FullConfig,
	FullResult,
	Suite,
	TestCase,
	TestResult,
	TestStep,
} from "@playwright/test/reporter";
import { beforeEach, describe, expect, test, vi } from "vitest";
import PlaywrightOpentelemetryReporter from "../src";
import {
	ATTR_CODE_FILE_PATH,
	ATTR_CODE_LINE_NUMBER,
	ATTR_TEST_CASE_TITLE,
} from "../src/otel-attributes";
import type {
	PlaywrightOpentelemetryReporterOptions,
	Span,
} from "../src/reporter";

// Mock the sender module
vi.mock("../src/sender", () => ({
	sendSpans: vi.fn(),
}));

import {
	ATTR_TEST_STEP_CATEGORY,
	ATTR_TEST_STEP_NAME,
	ATTR_TEST_STEP_TITLE,
	TEST_SPAN_NAME,
	TEST_STEP_SPAN_NAME,
} from "../src/reporter-attributes";
// Import the mocked function
import { sendSpans } from "../src/sender";

const defaultOptions: PlaywrightOpentelemetryReporterOptions = {
	tracesEndpoint: "http://localhost:4317/v1/traces",
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
		const [spans] = (sendSpans as any).mock.calls[0];

		// Should have 2 spans: 1 test span + 1 step span
		expect(spans).toHaveLength(2);

		// Find the test span and step span
		const testSpan = spans.find((s: Span) => s.name === TEST_SPAN_NAME);
		const stepSpan = spans.find((s: Span) => s.name === TEST_STEP_SPAN_NAME);

		expect(testSpan).toBeDefined();
		expect(stepSpan).toBeDefined();

		// Step span should have the test span as parent
		expect(stepSpan.parentSpanId).toBe(testSpan.spanId);
		expect(stepSpan.traceId).toBe(testSpan.traceId);

		// Verify step span timing
		expect(stepSpan.startTime).toEqual(new Date("2025-11-06T10:00:00.100Z"));
		expect(stepSpan.endTime).toEqual(new Date("2025-11-06T10:00:00.600Z"));

		// Verify test span has title attribute
		expect(testSpan.attributes).toMatchObject({
			[ATTR_TEST_CASE_TITLE]: "should login",
		});

		// Verify step span attributes
		expect(stepSpan.attributes).toMatchObject({
			[ATTR_CODE_FILE_PATH]: "auth.spec.ts",
			[ATTR_CODE_LINE_NUMBER]: 10,
			[ATTR_TEST_STEP_NAME]: "Login step",
			[ATTR_TEST_STEP_TITLE]: "Login step",
			[ATTR_TEST_STEP_CATEGORY]: "test.step",
		});
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
		const [spans] = (sendSpans as any).mock.calls[0];

		// Should have 3 spans: 1 test span + 1 parent step span + 1 child step span
		expect(spans).toHaveLength(3);

		const testSpan = spans.find((s: Span) => s.name === TEST_SPAN_NAME);
		const parentStepSpan = spans.find(
			(s: Span) =>
				s.name === TEST_STEP_SPAN_NAME &&
				s.attributes[ATTR_TEST_STEP_TITLE] === "Login flow",
		);
		const childStepSpan = spans.find(
			(s: Span) =>
				s.name === TEST_STEP_SPAN_NAME &&
				s.attributes[ATTR_TEST_STEP_TITLE] === "Fill username",
		);

		expect(testSpan).toBeDefined();
		expect(parentStepSpan).toBeDefined();
		expect(childStepSpan).toBeDefined();

		// Verify parent relationships
		expect(parentStepSpan.parentSpanId).toBe(testSpan.spanId);
		expect(childStepSpan.parentSpanId).toBe(parentStepSpan.spanId);

		// All spans should share the same traceId
		expect(parentStepSpan.traceId).toBe(testSpan.traceId);
		expect(childStepSpan.traceId).toBe(testSpan.traceId);

		// Verify step names include the full path
		expect(parentStepSpan.attributes[ATTR_TEST_STEP_NAME]).toBe("Login flow");
		expect(parentStepSpan.attributes[ATTR_TEST_STEP_TITLE]).toBe("Login flow");

		// Child step name should include parent in path
		expect(childStepSpan.attributes[ATTR_TEST_STEP_NAME]).toBe(
			"Login flow > Fill username",
		);
		expect(childStepSpan.attributes[ATTR_TEST_STEP_TITLE]).toBe(
			"Fill username",
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
		const [spans] = (sendSpans as any).mock.calls[0];

		// Should have 4 spans: 1 test span + 3 step spans
		expect(spans).toHaveLength(4);

		const testSpan = spans.find((s: Span) => s.name === TEST_SPAN_NAME);
		const step1Span = spans.find(
			(s: Span) =>
				s.name === TEST_STEP_SPAN_NAME &&
				s.attributes[ATTR_TEST_STEP_NAME] === "Step 1",
		);
		const step2Span = spans.find(
			(s: Span) =>
				s.name === TEST_STEP_SPAN_NAME &&
				s.attributes[ATTR_TEST_STEP_NAME] === "Step 2",
		);
		const step3Span = spans.find(
			(s: Span) =>
				s.name === TEST_STEP_SPAN_NAME &&
				s.attributes[ATTR_TEST_STEP_NAME] === "Step 3",
		);

		expect(testSpan).toBeDefined();
		expect(step1Span).toBeDefined();
		expect(step2Span).toBeDefined();
		expect(step3Span).toBeDefined();

		// All step spans should have the test span as parent
		expect(step1Span.parentSpanId).toBe(testSpan.spanId);
		expect(step2Span.parentSpanId).toBe(testSpan.spanId);
		expect(step3Span.parentSpanId).toBe(testSpan.spanId);
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
		const [spans] = (sendSpans as any).mock.calls[0];

		// Should have 4 spans: 1 test span + 3 nested step spans
		expect(spans).toHaveLength(4);

		const testSpan = spans.find((s: Span) => s.name === TEST_SPAN_NAME);
		const level1Span = spans.find(
			(s: Span) =>
				s.name === TEST_STEP_SPAN_NAME &&
				s.attributes[ATTR_TEST_STEP_TITLE] === "Level 1",
		);
		const level2Span = spans.find(
			(s: Span) =>
				s.name === TEST_STEP_SPAN_NAME &&
				s.attributes[ATTR_TEST_STEP_TITLE] === "Level 2",
		);
		const level3Span = spans.find(
			(s: Span) =>
				s.name === TEST_STEP_SPAN_NAME &&
				s.attributes[ATTR_TEST_STEP_TITLE] === "Level 3",
		);

		expect(testSpan).toBeDefined();
		expect(level1Span).toBeDefined();
		expect(level2Span).toBeDefined();
		expect(level3Span).toBeDefined();

		// Verify the chain of parent relationships
		expect(level1Span.parentSpanId).toBe(testSpan.spanId);
		expect(level2Span.parentSpanId).toBe(level1Span.spanId);
		expect(level3Span.parentSpanId).toBe(level2Span.spanId);

		// All spans should share the same traceId
		expect(level1Span.traceId).toBe(testSpan.traceId);
		expect(level2Span.traceId).toBe(testSpan.traceId);
		expect(level3Span.traceId).toBe(testSpan.traceId);

		// Verify step names build the full path
		expect(level1Span.attributes[ATTR_TEST_STEP_NAME]).toBe("Level 1");
		expect(level1Span.attributes[ATTR_TEST_STEP_TITLE]).toBe("Level 1");

		expect(level2Span.attributes[ATTR_TEST_STEP_NAME]).toBe(
			"Level 1 > Level 2",
		);
		expect(level2Span.attributes[ATTR_TEST_STEP_TITLE]).toBe("Level 2");

		expect(level3Span.attributes[ATTR_TEST_STEP_NAME]).toBe(
			"Level 1 > Level 2 > Level 3",
		);
		expect(level3Span.attributes[ATTR_TEST_STEP_TITLE]).toBe("Level 3");
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
		const [spans] = (sendSpans as any).mock.calls[0];

		const stepSpan = spans.find(
			(s: Span) =>
				s.name === TEST_STEP_SPAN_NAME &&
				s.attributes[ATTR_TEST_STEP_NAME] === "Failing step",
		);

		expect(stepSpan).toBeDefined();
		// Step span should have ERROR status (code: 2) because it has an error
		expect(stepSpan.status.code).toBe(2);
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
		const [spans] = (sendSpans as any).mock.calls[0];

		const stepSpan = spans.find(
			(s: Span) =>
				s.name === TEST_STEP_SPAN_NAME &&
				s.attributes[ATTR_TEST_STEP_NAME] === "Step without location",
		);

		expect(stepSpan).toBeDefined();
		// Should not have location attributes
		expect(stepSpan.attributes).not.toHaveProperty(ATTR_CODE_FILE_PATH);
		expect(stepSpan.attributes).not.toHaveProperty(ATTR_CODE_LINE_NUMBER);
		// But should have name, title and category
		expect(stepSpan.attributes).toMatchObject({
			[ATTR_TEST_STEP_NAME]: "Step without location",
			[ATTR_TEST_STEP_TITLE]: "Step without location",
			[ATTR_TEST_STEP_CATEGORY]: "test.step",
		});
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
		const [spans] = (sendSpans as any).mock.calls[0];

		// Should have only 1 span: the test span
		expect(spans).toHaveLength(1);

		const testSpan = spans[0];
		expect(testSpan.name).toBe(TEST_SPAN_NAME);
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
		const [spans] = (sendSpans as any).mock.calls[0];

		// Should have 4 spans: 1 test span + 3 step spans (all categories included)
		expect(spans).toHaveLength(4);

		const stepSpans = spans.filter((s: Span) => s.name === TEST_STEP_SPAN_NAME);
		expect(stepSpans).toHaveLength(3);

		// Find each step by category
		const testStepSpan = stepSpans.find(
			(s: Span) => s.attributes[ATTR_TEST_STEP_CATEGORY] === "test.step",
		);
		const expectStepSpan = stepSpans.find(
			(s: Span) => s.attributes[ATTR_TEST_STEP_CATEGORY] === "expect",
		);
		const apiStepSpan = stepSpans.find(
			(s: Span) => s.attributes[ATTR_TEST_STEP_CATEGORY] === "pw:api",
		);

		expect(testStepSpan).toBeDefined();
		expect(testStepSpan?.attributes[ATTR_TEST_STEP_NAME]).toBe("User step");
		expect(testStepSpan?.attributes[ATTR_TEST_STEP_TITLE]).toBe("User step");

		expect(expectStepSpan).toBeDefined();
		expect(expectStepSpan?.attributes[ATTR_TEST_STEP_NAME]).toBe(
			"expect.toBeVisible",
		);
		expect(expectStepSpan?.attributes[ATTR_TEST_STEP_TITLE]).toBe(
			"expect.toBeVisible",
		);

		expect(apiStepSpan).toBeDefined();
		expect(apiStepSpan?.attributes[ATTR_TEST_STEP_NAME]).toBe("page.click");
		expect(apiStepSpan?.attributes[ATTR_TEST_STEP_TITLE]).toBe("page.click");
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
		const [spans] = (sendSpans as any).mock.calls[0];

		// Should have 5 spans: 1 test + Step 1 + SubStep 1.1 + SubStep 1.2 (expect) + Step 2
		expect(spans).toHaveLength(5);

		const testSpan = spans.find((s: Span) => s.name === TEST_SPAN_NAME);
		const step1Span = spans.find(
			(s: Span) =>
				s.name === TEST_STEP_SPAN_NAME &&
				s.attributes[ATTR_TEST_STEP_TITLE] === "Step 1",
		);
		const substep11Span = spans.find(
			(s: Span) =>
				s.name === TEST_STEP_SPAN_NAME &&
				s.attributes[ATTR_TEST_STEP_TITLE] === "SubStep 1.1",
		);
		const expectStepSpan = spans.find(
			(s: Span) =>
				s.name === TEST_STEP_SPAN_NAME &&
				s.attributes[ATTR_TEST_STEP_TITLE] === "expect.toBeVisible",
		);
		const step2Span = spans.find(
			(s: Span) =>
				s.name === TEST_STEP_SPAN_NAME &&
				s.attributes[ATTR_TEST_STEP_TITLE] === "Step 2",
		);

		expect(testSpan).toBeDefined();
		expect(step1Span).toBeDefined();
		expect(substep11Span).toBeDefined();
		expect(expectStepSpan).toBeDefined();
		expect(step2Span).toBeDefined();

		// Verify parent relationships
		expect(step1Span.parentSpanId).toBe(testSpan.spanId);
		expect(substep11Span.parentSpanId).toBe(step1Span.spanId);
		expect(expectStepSpan?.parentSpanId).toBe(step1Span.spanId);
		expect(step2Span.parentSpanId).toBe(testSpan.spanId);

		// Verify step names with nesting
		expect(step1Span.attributes[ATTR_TEST_STEP_NAME]).toBe("Step 1");
		expect(substep11Span.attributes[ATTR_TEST_STEP_NAME]).toBe(
			"Step 1 > SubStep 1.1",
		);
		expect(expectStepSpan?.attributes[ATTR_TEST_STEP_NAME]).toBe(
			"Step 1 > expect.toBeVisible",
		);
		expect(step2Span.attributes[ATTR_TEST_STEP_NAME]).toBe("Step 2");

		// Verify categories are correctly set
		expect(substep11Span.attributes[ATTR_TEST_STEP_CATEGORY]).toBe("test.step");
		expect(expectStepSpan?.attributes[ATTR_TEST_STEP_CATEGORY]).toBe("expect");
		expect(step2Span.attributes[ATTR_TEST_STEP_CATEGORY]).toBe("test.step");
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
		const [spans] = (sendSpans as any).mock.calls[0];

		const stepSpan = spans.find(
			(s: Span) =>
				s.name === TEST_STEP_SPAN_NAME &&
				s.attributes[ATTR_TEST_STEP_NAME] === "User defined step",
		);

		expect(stepSpan).toBeDefined();
		expect(stepSpan.attributes).toMatchObject({
			[ATTR_TEST_STEP_NAME]: "User defined step",
			[ATTR_TEST_STEP_TITLE]: "User defined step",
			[ATTR_TEST_STEP_CATEGORY]: "test.step",
		});
	});
});
