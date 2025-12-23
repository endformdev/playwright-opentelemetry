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
