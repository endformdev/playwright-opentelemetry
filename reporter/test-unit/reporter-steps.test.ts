import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ATTR_CODE_FILE_PATH,
	ATTR_CODE_LINE_NUMBER,
	ATTR_TEST_CASE_TITLE,
} from "../src/reporter/otel-attributes";
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

describe("PlaywrightOpentelemetryReporter - Test Steps", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates a span for a test with a single step", async () => {
		await runReporterTest({
			test: {
				title: "should login",
				titlePath: ["", "chromium", "auth.spec.ts", "should login"],
				location: {
					file: "/Users/test/project/test-e2e/auth.spec.ts",
					line: 8,
				},
			},
			result: {
				steps: [
					{
						title: "Login step",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.100Z"),
						duration: 500,
						location: {
							file: "/Users/test/project/test-e2e/auth.spec.ts",
							line: 10,
						},
					},
				],
			},
		});

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

	it("creates nested spans for nested steps", async () => {
		await runReporterTest({
			test: {
				title: "should login",
				titlePath: ["", "chromium", "auth.spec.ts", "should login"],
				location: {
					file: "/Users/test/project/test-e2e/auth.spec.ts",
					line: 8,
				},
			},
			result: {
				steps: [
					{
						title: "Login flow",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.100Z"),
						duration: 500,
						location: {
							file: "/Users/test/project/test-e2e/auth.spec.ts",
							line: 11,
						},
						steps: [
							{
								title: "Fill username",
								category: "test.step",
								startTime: new Date("2025-11-06T10:00:00.200Z"),
								duration: 200,
								location: {
									file: "/Users/test/project/test-e2e/auth.spec.ts",
									line: 12,
								},
							},
						],
					},
				],
			},
		});

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

	it("creates spans for multiple sibling steps", async () => {
		await runReporterTest({
			test: {
				title: "test with multiple steps",
				titlePath: ["", "chromium", "test.spec.ts", "test with multiple steps"],
				location: {
					file: "/Users/test/project/test-e2e/test.spec.ts",
					line: 5,
				},
			},
			result: {
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
						startTime: new Date("2025-11-06T10:00:00.300Z"),
						duration: 300,
					},
					{
						title: "Step 3",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.600Z"),
						duration: 100,
					},
				],
			},
		});

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

	it("creates deeply nested spans (3 levels)", async () => {
		await runReporterTest({
			test: {
				title: "deeply nested test",
				titlePath: ["", "chromium", "test.spec.ts", "deeply nested test"],
				location: {
					file: "/Users/test/project/test-e2e/test.spec.ts",
					line: 5,
				},
			},
			result: {
				steps: [
					{
						title: "Level 1",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.100Z"),
						duration: 500,
						steps: [
							{
								title: "Level 2",
								category: "test.step",
								startTime: new Date("2025-11-06T10:00:00.200Z"),
								duration: 300,
								steps: [
									{
										title: "Level 3",
										category: "test.step",
										startTime: new Date("2025-11-06T10:00:00.300Z"),
										duration: 100,
									},
								],
							},
						],
					},
				],
			},
		});

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

	it("handles step with error correctly", async () => {
		await runReporterTest({
			test: {
				title: "test with failing step",
				titlePath: ["", "chromium", "test.spec.ts", "test with failing step"],
				location: {
					file: "/Users/test/project/test-e2e/test.spec.ts",
					line: 8,
				},
			},
			result: {
				status: "failed",
				duration: 500,
				steps: [
					{
						title: "Failing step",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.100Z"),
						duration: 200,
						error: {
							message: "Expected element to be visible",
							stack: "Error: Expected element to be visible\n    at ...",
						},
						location: {
							file: "/Users/test/project/test-e2e/test.spec.ts",
							line: 10,
						},
					},
				],
			},
		});

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

	it("handles steps without location information", async () => {
		await runReporterTest({
			test: {
				title: "test",
				titlePath: ["", "chromium", "test.spec.ts", "test"],
				location: {
					file: "/Users/test/project/test-e2e/test.spec.ts",
					line: 5,
				},
			},
			result: {
				duration: 500,
				steps: [
					{
						title: "Step without location",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.100Z"),
						duration: 200,
					},
				],
			},
		});

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

	it("handles test with no steps", async () => {
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
				duration: 500,
				steps: [],
			},
		});

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

	it("includes all step categories", async () => {
		await runReporterTest({
			test: {
				title: "test with mixed step categories",
				titlePath: [
					"",
					"chromium",
					"test.spec.ts",
					"test with mixed step categories",
				],
				location: {
					file: "/Users/test/project/test-e2e/test.spec.ts",
					line: 5,
				},
			},
			result: {
				duration: 500,
				steps: [
					{
						title: "User step",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.100Z"),
						duration: 200,
					},
					{
						title: "expect.toBeVisible",
						category: "expect",
						startTime: new Date("2025-11-06T10:00:00.300Z"),
						duration: 50,
					},
					{
						title: "page.click",
						category: "pw:api",
						startTime: new Date("2025-11-06T10:00:00.350Z"),
						duration: 100,
					},
				],
			},
		});

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

	it("handles complex nested structure with mixed step types", async () => {
		// Nested structure:
		// Step 1 (test.step)
		//   -> SubStep 1.1 (test.step)
		//   -> SubStep 1.2 (expect)
		// Step 2 (test.step)
		await runReporterTest({
			test: {
				title: "complex nested test",
				titlePath: ["", "chromium", "test.spec.ts", "complex nested test"],
				location: {
					file: "/Users/test/project/test-e2e/test.spec.ts",
					line: 5,
				},
			},
			result: {
				duration: 700,
				steps: [
					{
						title: "Step 1",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.100Z"),
						duration: 300,
						steps: [
							{
								title: "SubStep 1.1",
								category: "test.step",
								startTime: new Date("2025-11-06T10:00:00.150Z"),
								duration: 100,
							},
							{
								title: "expect.toBeVisible",
								category: "expect",
								startTime: new Date("2025-11-06T10:00:00.250Z"),
								duration: 50,
							},
						],
					},
					{
						title: "Step 2",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.400Z"),
						duration: 200,
					},
				],
			},
		});

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

	it("adds category attribute to step spans", async () => {
		await runReporterTest({
			test: {
				title: "test",
				titlePath: ["", "chromium", "test.spec.ts", "test"],
				location: {
					file: "/Users/test/project/test-e2e/test.spec.ts",
					line: 5,
				},
			},
			result: {
				duration: 500,
				steps: [
					{
						title: "User defined step",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.100Z"),
						duration: 200,
					},
				],
			},
		});

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

	it("skips internal fixture steps from playwright-opentelemetry without causing errors", async () => {
		// This test reproduces a bug where internal fixture steps were being marked
		// with empty marker objects that later caused "Cannot read properties of undefined"
		// errors when trying to serialize spans (specifically accessing startTime.getTime())
		await runReporterTest({
			test: {
				title: "test with internal fixture",
				titlePath: [
					"",
					"chromium",
					"test.spec.ts",
					"test with internal fixture",
				],
				location: {
					file: "/Users/test/project/test-e2e/test.spec.ts",
					line: 5,
				},
			},
			result: {
				duration: 500,
				steps: [
					{
						// This is the internal fixture step that should be skipped
						title: "fixture: page",
						category: "fixture",
						startTime: new Date("2025-11-06T10:00:00.050Z"),
						duration: 50,
						location: {
							file: "/Users/test/project/node_modules/playwright-opentelemetry/dist/fixture.mjs",
							line: 10,
						},
					},
					{
						title: "User step",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.100Z"),
						duration: 200,
					},
				],
			},
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);

		// Verify that the spans array contains valid spans with proper startTime/endTime
		const [spans] = (sendSpans as ReturnType<typeof vi.fn>).mock.calls[0];
		for (const span of spans) {
			// Every span must have a valid startTime and endTime (Date objects)
			expect(span.startTime).toBeInstanceOf(Date);
			expect(span.endTime).toBeInstanceOf(Date);
		}

		// The internal fixture step should NOT appear in the spans
		expect(sendSpans).toHaveBeenCalledWith(
			expect.not.arrayContaining([
				expect.objectContaining({
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_TITLE]: "fixture: page",
					}),
				}),
			]),
			expect.any(Object),
		);

		// The user step should still be present
		expect(sendSpans).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "User step",
					}),
				}),
			]),
			expect.any(Object),
		);
	});
});
