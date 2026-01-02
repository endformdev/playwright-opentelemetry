import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ATTR_CODE_FILE_PATH,
	ATTR_CODE_LINE_NUMBER,
	ATTR_TEST_CASE_NAME,
	ATTR_TEST_CASE_RESULT_STATUS,
	ATTR_TEST_CASE_TITLE,
} from "../src/reporter/otel-attributes";
import { TEST_SPAN_NAME } from "../src/reporter/reporter-attributes";
import { runReporterTest } from "./reporter-harness";

// Mock the sender module
vi.mock("../src/reporter/sender", () => ({
	sendSpans: vi.fn(),
}));

// Import the mocked function
import { sendSpans } from "../src/reporter/sender";

describe("PlaywrightOpentelemetryReporter - Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("sends a span for a test that ran", async () => {
		await runReporterTest({
			test: {
				title: "example test",
				location: {
					file: "/Users/test/project/test-e2e/example.spec.ts",
					line: 3,
				},
			},
			result: { duration: 1500 },
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);
		expect(sendSpans).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					name: TEST_SPAN_NAME,
					startTime: new Date("2025-11-06T10:00:00.000Z"),
					endTime: new Date("2025-11-06T10:00:01.500Z"),
					attributes: {
						[ATTR_TEST_CASE_NAME]: "example test",
						[ATTR_TEST_CASE_TITLE]: "example test",
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
				tracesEndpoint: "http://localhost:4317/v1/traces",
				serviceName: "playwright-tests",
				playwrightVersion: "1.56.1",
				debug: true,
			}),
		);
	});

	it("handles test without location information", async () => {
		await runReporterTest({
			test: {
				title: "test without location",
				titlePath: ["", "chromium", "test.spec.ts", "test without location"],
			},
		});

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
				tracesEndpoint: "http://localhost:4317/v1/traces",
				serviceName: "playwright-tests",
				playwrightVersion: "1.56.1",
				debug: true,
			}),
		);
	});

	it("calculates relative path correctly for nested directories", async () => {
		await runReporterTest({
			test: {
				title: "nested test",
				titlePath: ["", "chromium", "nested.spec.ts", "nested test"],
				location: {
					file: "/Users/test/project/test-e2e/sub/dir/nested.spec.ts",
					line: 10,
				},
			},
		});

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
				tracesEndpoint: "http://localhost:4317/v1/traces",
				serviceName: "playwright-tests",
				playwrightVersion: "1.56.1",
				debug: true,
			}),
		);
	});

	it("includes describe blocks in test case name", async () => {
		await runReporterTest({
			test: {
				title: "get started link",
				titlePath: [
					"",
					"chromium",
					"example.spec.ts",
					"described tests",
					"get started link",
				],
				location: {
					file: "/Users/test/project/test-e2e/example.spec.ts",
					line: 11,
				},
			},
		});

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
				tracesEndpoint: "http://localhost:4317/v1/traces",
				serviceName: "playwright-tests",
				playwrightVersion: "1.56.1",
				debug: true,
			}),
		);
	});

	it("handles nested describe blocks in test case name", async () => {
		await runReporterTest({
			test: {
				title: "should work correctly",
				titlePath: [
					"",
					"chromium",
					"feature.spec.ts",
					"Feature A",
					"Scenario 1",
					"Case B",
					"should work correctly",
				],
				location: {
					file: "/Users/test/project/test-e2e/feature.spec.ts",
					line: 20,
				},
			},
			result: { duration: 2000 },
		});

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
				tracesEndpoint: "http://localhost:4317/v1/traces",
				serviceName: "playwright-tests",
				playwrightVersion: "1.56.1",
				debug: true,
			}),
		);
	});

	it("handles failed test status when expected to pass", async () => {
		await runReporterTest({
			test: {
				title: "failing test",
				titlePath: ["", "chromium", "test.spec.ts", "failing test"],
				expectedStatus: "passed",
				location: {
					file: "/Users/test/project/test-e2e/test.spec.ts",
					line: 5,
				},
			},
			result: { status: "failed" },
		});

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
				tracesEndpoint: "http://localhost:4317/v1/traces",
				serviceName: "playwright-tests",
				playwrightVersion: "1.56.1",
				debug: true,
			}),
		);
	});

	it("handles expected failure correctly", async () => {
		await runReporterTest({
			test: {
				title: "expected to fail",
				titlePath: ["", "chromium", "test.spec.ts", "expected to fail"],
				expectedStatus: "failed",
				location: {
					file: "/Users/test/project/test-e2e/test.spec.ts",
					line: 10,
				},
			},
			result: { status: "failed" },
		});

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
				tracesEndpoint: "http://localhost:4317/v1/traces",
				serviceName: "playwright-tests",
				playwrightVersion: "1.56.1",
				debug: true,
			}),
		);
	});
});

describe("PlaywrightOpentelemetryReporter - Span Timing Encapsulation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("expands test span start time to encompass beforeEach hook that starts earlier", async () => {
		// Simulate a beforeEach hook that runs before the test body starts
		// Test reported start: 10:00:00.100
		// beforeEach hook starts: 10:00:00.000 (100ms earlier)
		await runReporterTest({
			test: {
				title: "test with beforeEach",
				titlePath: ["", "chromium", "test.spec.ts", "test with beforeEach"],
				location: {
					file: "/Users/test/project/test-e2e/test.spec.ts",
					line: 5,
				},
			},
			result: {
				startTime: new Date("2025-11-06T10:00:00.100Z"),
				duration: 500, // ends at 10:00:00.600
				steps: [
					{
						title: "beforeEach hook",
						category: "hook",
						startTime: new Date("2025-11-06T10:00:00.000Z"), // starts 100ms before test
						duration: 80, // ends at 10:00:00.080
					},
					{
						title: "Test body step",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.150Z"),
						duration: 200,
					},
				],
			},
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);
		const [spans] = (sendSpans as ReturnType<typeof vi.fn>).mock.calls[0];
		const testSpan = spans.find(
			(s: { name: string }) => s.name === TEST_SPAN_NAME,
		);

		// Test span should start when the beforeEach hook started
		expect(testSpan.startTime).toEqual(new Date("2025-11-06T10:00:00.000Z"));
		// Test span should end at the reported end time (no later steps)
		expect(testSpan.endTime).toEqual(new Date("2025-11-06T10:00:00.600Z"));
	});

	it("expands test span end time to encompass afterEach hook that ends later", async () => {
		// Simulate an afterEach hook that runs after the test body ends
		// Test reported end: 10:00:00.600 (start + duration)
		// afterEach hook ends: 10:00:00.800 (200ms later)
		await runReporterTest({
			test: {
				title: "test with afterEach",
				titlePath: ["", "chromium", "test.spec.ts", "test with afterEach"],
				location: {
					file: "/Users/test/project/test-e2e/test.spec.ts",
					line: 5,
				},
			},
			result: {
				startTime: new Date("2025-11-06T10:00:00.100Z"),
				duration: 500, // ends at 10:00:00.600
				steps: [
					{
						title: "Test body step",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.150Z"),
						duration: 200,
					},
					{
						title: "afterEach hook",
						category: "hook",
						startTime: new Date("2025-11-06T10:00:00.600Z"), // starts when test body ends
						duration: 200, // ends at 10:00:00.800
					},
				],
			},
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);
		const [spans] = (sendSpans as ReturnType<typeof vi.fn>).mock.calls[0];
		const testSpan = spans.find(
			(s: { name: string }) => s.name === TEST_SPAN_NAME,
		);

		// Test span should start at reported start time
		expect(testSpan.startTime).toEqual(new Date("2025-11-06T10:00:00.100Z"));
		// Test span should end when the afterEach hook ends
		expect(testSpan.endTime).toEqual(new Date("2025-11-06T10:00:00.800Z"));
	});

	it("expands test span to encompass both beforeEach and afterEach hooks", async () => {
		// Full scenario: beforeEach starts before test, afterEach ends after test
		await runReporterTest({
			test: {
				title: "test with both hooks",
				titlePath: ["", "chromium", "test.spec.ts", "test with both hooks"],
				location: {
					file: "/Users/test/project/test-e2e/test.spec.ts",
					line: 5,
				},
			},
			result: {
				startTime: new Date("2025-11-06T10:00:00.200Z"),
				duration: 400, // ends at 10:00:00.600
				steps: [
					{
						title: "beforeEach hook",
						category: "hook",
						startTime: new Date("2025-11-06T10:00:00.000Z"), // 200ms before test
						duration: 150, // ends at 10:00:00.150
					},
					{
						title: "Test body step",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.250Z"),
						duration: 300,
					},
					{
						title: "afterEach hook",
						category: "hook",
						startTime: new Date("2025-11-06T10:00:00.600Z"),
						duration: 300, // ends at 10:00:00.900
					},
				],
			},
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);
		const [spans] = (sendSpans as ReturnType<typeof vi.fn>).mock.calls[0];
		const testSpan = spans.find(
			(s: { name: string }) => s.name === TEST_SPAN_NAME,
		);

		// Test span should encompass the full lifecycle
		expect(testSpan.startTime).toEqual(new Date("2025-11-06T10:00:00.000Z"));
		expect(testSpan.endTime).toEqual(new Date("2025-11-06T10:00:00.900Z"));
	});

	it("expands test span for fixture setup that starts before test", async () => {
		// Fixtures can also run before the test body
		await runReporterTest({
			test: {
				title: "test with fixture",
				titlePath: ["", "chromium", "test.spec.ts", "test with fixture"],
				location: {
					file: "/Users/test/project/test-e2e/test.spec.ts",
					line: 5,
				},
			},
			result: {
				startTime: new Date("2025-11-06T10:00:00.300Z"),
				duration: 400,
				steps: [
					{
						title: "fixture: page",
						category: "fixture",
						startTime: new Date("2025-11-06T10:00:00.050Z"), // fixture setup before test
						duration: 200,
						location: {
							file: "/Users/test/project/node_modules/@playwright/test/index.js",
							line: 100,
						},
					},
					{
						title: "Test step",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.350Z"),
						duration: 200,
					},
				],
			},
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);
		const [spans] = (sendSpans as ReturnType<typeof vi.fn>).mock.calls[0];
		const testSpan = spans.find(
			(s: { name: string }) => s.name === TEST_SPAN_NAME,
		);

		// Test span should start when fixture setup started
		expect(testSpan.startTime).toEqual(new Date("2025-11-06T10:00:00.050Z"));
	});

	it("expands test span for nested steps that extend beyond parent timing", async () => {
		// Nested steps can sometimes have timing that extends beyond their parent
		await runReporterTest({
			test: {
				title: "test with nested steps",
				titlePath: ["", "chromium", "test.spec.ts", "test with nested steps"],
				location: {
					file: "/Users/test/project/test-e2e/test.spec.ts",
					line: 5,
				},
			},
			result: {
				startTime: new Date("2025-11-06T10:00:00.100Z"),
				duration: 400, // ends at 10:00:00.500
				steps: [
					{
						title: "Parent step",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.150Z"),
						duration: 200,
						steps: [
							{
								title: "Nested async step",
								category: "test.step",
								startTime: new Date("2025-11-06T10:00:00.200Z"),
								duration: 500, // ends at 10:00:00.700 - beyond test end
							},
						],
					},
				],
			},
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);
		const [spans] = (sendSpans as ReturnType<typeof vi.fn>).mock.calls[0];
		const testSpan = spans.find(
			(s: { name: string }) => s.name === TEST_SPAN_NAME,
		);

		// Test span should end when the nested step ends
		expect(testSpan.endTime).toEqual(new Date("2025-11-06T10:00:00.700Z"));
	});

	it("keeps original timing when all steps are within test bounds", async () => {
		// When all steps fit within the test timing, don't expand
		await runReporterTest({
			test: {
				title: "test with contained steps",
				titlePath: [
					"",
					"chromium",
					"test.spec.ts",
					"test with contained steps",
				],
				location: {
					file: "/Users/test/project/test-e2e/test.spec.ts",
					line: 5,
				},
			},
			result: {
				startTime: new Date("2025-11-06T10:00:00.000Z"),
				duration: 1000, // ends at 10:00:01.000
				steps: [
					{
						title: "Step 1",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.100Z"),
						duration: 200,
					},
					{
						title: "Step 2",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.400Z"),
						duration: 300,
					},
				],
			},
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);
		const [spans] = (sendSpans as ReturnType<typeof vi.fn>).mock.calls[0];
		const testSpan = spans.find(
			(s: { name: string }) => s.name === TEST_SPAN_NAME,
		);

		// Test span should keep original timing
		expect(testSpan.startTime).toEqual(new Date("2025-11-06T10:00:00.000Z"));
		expect(testSpan.endTime).toEqual(new Date("2025-11-06T10:00:01.000Z"));
	});

	it("uses original timing when there are no steps", async () => {
		await runReporterTest({
			test: {
				title: "test without steps",
				titlePath: ["", "chromium", "test.spec.ts", "test without steps"],
				location: {
					file: "/Users/test/project/test-e2e/test.spec.ts",
					line: 5,
				},
			},
			result: {
				startTime: new Date("2025-11-06T10:00:00.000Z"),
				duration: 500,
				steps: [],
			},
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);
		const [spans] = (sendSpans as ReturnType<typeof vi.fn>).mock.calls[0];
		const testSpan = spans.find(
			(s: { name: string }) => s.name === TEST_SPAN_NAME,
		);

		// Test span should use original timing
		expect(testSpan.startTime).toEqual(new Date("2025-11-06T10:00:00.000Z"));
		expect(testSpan.endTime).toEqual(new Date("2025-11-06T10:00:00.500Z"));
	});
});
