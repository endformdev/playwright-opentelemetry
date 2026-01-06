import { existsSync, mkdirSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { FullResult, Suite } from "@playwright/test/reporter";
import {
	BlobReader,
	BlobWriter,
	TextWriter,
	Uint8ArrayWriter,
	ZipReader,
	ZipWriter,
} from "@zip.js/zip.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildConfig,
	buildTestCase,
	buildTestResult,
	DEFAULT_REPORTER_OPTIONS,
	DEFAULT_ROOT_DIR,
	DEFAULT_START_TIME,
	PlaywrightOpentelemetryReporter,
} from "./reporter-harness";

// Mock the sender module to prevent actual HTTP calls but keep buildOtlpRequest
vi.mock("../src/reporter/sender", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../src/reporter/sender")>();
	return {
		...actual,
		sendSpans: vi.fn(),
	};
});

import { sendSpans } from "../src/reporter/sender";

/**
 * Helper to create a unique test output directory
 */
function createTestOutputDir(testName: string): string {
	const outputDir = `/tmp/trace-zip-test-${testName}-${Date.now()}`;
	mkdirSync(outputDir, { recursive: true });
	return outputDir;
}

/**
 * Creates a minimal valid JPEG buffer for testing
 */
function createMinimalJpeg(): Buffer {
	return Buffer.from([
		0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
		0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
	]);
}

/**
 * Creates a mock Playwright trace ZIP file with screenshots in resources/ directory.
 * This simulates what Playwright creates when tracing is enabled.
 *
 * Playwright trace ZIP structure:
 * trace.zip/
 * ├── trace.trace          # JSON lines of trace events
 * └── resources/
 *     ├── {pageGuid}-{timestamp}.jpeg   # Screenshot frames
 *     └── ...
 *
 * @param outputDir - Directory to write the trace ZIP to
 * @param screenshots - Array of screenshot info with pageGuid and timestamp
 * @returns Path to the created trace ZIP file
 */
async function createMockPlaywrightTraceZip(
	outputDir: string,
	screenshots: Array<{ pageGuid: string; timestamp: number }>,
): Promise<string> {
	const traceZipPath = path.join(outputDir, "trace.zip");

	const blobWriter = new BlobWriter("application/zip");
	const zipWriter = new ZipWriter(blobWriter);

	// Add a minimal trace.trace file (JSON lines format)
	const traceEvents = JSON.stringify({ name: "trace", version: 1 });
	await zipWriter.add(
		"trace.trace",
		new Blob([traceEvents]).stream() as ReadableStream,
	);

	// Add screenshots to resources/ directory
	const jpegBuffer = createMinimalJpeg();
	for (const { pageGuid, timestamp } of screenshots) {
		const filename = `resources/${pageGuid}-${timestamp}.jpeg`;
		await zipWriter.add(
			filename,
			new Blob([new Uint8Array(jpegBuffer)]).stream() as ReadableStream,
		);
	}

	const zipBlob = await zipWriter.close();
	const arrayBuffer = await zipBlob.arrayBuffer();
	await fs.writeFile(traceZipPath, Buffer.from(arrayBuffer));

	return traceZipPath;
}

/**
 * Helper to read zip file entries using @zip.js/zip.js
 */
async function readZipEntries(
	zipPath: string,
): Promise<Map<string, Uint8Array | string>> {
	const zipBuffer = await fs.readFile(zipPath);
	const zipBlob = new Blob([zipBuffer]);
	const zipReader = new ZipReader(new BlobReader(zipBlob));
	const entries = await zipReader.getEntries();

	const results = new Map<string, Uint8Array | string>();

	for (const entry of entries) {
		if (!entry.directory && entry.getData) {
			const filename = entry.filename;

			// Read as text for JSON files, as binary for images
			if (filename.endsWith(".json")) {
				const textWriter = new TextWriter();
				const text = await entry.getData(textWriter);
				results.set(filename, text);
			} else {
				const uint8ArrayWriter = new Uint8ArrayWriter();
				const data = await entry.getData(uint8ArrayWriter);
				results.set(filename, data);
			}
		}
	}

	await zipReader.close();
	return results;
}

/**
 * Extracts pageGuid from a screenshot filename.
 *
 * Playwright screenshot filename format: {pageGuid}-{timestamp}.jpeg
 * Example: page@f06f11f7c14d6ce1060d47d79f05c154-1766833384425.jpeg
 *
 * The pageGuid is everything before the last dash.
 */
function extractPageGuidFromFilename(filename: string): string | null {
	const basename = path.basename(filename);
	const lastDashIndex = basename.lastIndexOf("-");

	if (lastDashIndex === -1) {
		return null;
	}

	return basename.slice(0, lastDashIndex);
}

describe("extractPageGuidFromFilename", () => {
	it("extracts pageGuid from screenshot filename", () => {
		const filename = "page@f06f11f7c14d6ce1060d47d79f05c154-1766833384425.jpeg";
		const pageGuid = extractPageGuidFromFilename(filename);
		expect(pageGuid).toBe("page@f06f11f7c14d6ce1060d47d79f05c154");
	});

	it("handles nested paths correctly", () => {
		const filename =
			".playwright-artifacts-0/traces/resources/page@f06f11f7c14d6ce1060d47d79f05c154-1766833384425.jpeg";
		const pageGuid = extractPageGuidFromFilename(filename);
		expect(pageGuid).toBe("page@f06f11f7c14d6ce1060d47d79f05c154");
	});

	it("returns null for filename without timestamp dash", () => {
		const filename = "page@f06f11f7c14d6ce1060d47d79f05c154.jpeg";
		const pageGuid = extractPageGuidFromFilename(filename);
		expect(pageGuid).toBeNull();
	});
});

describe("PlaywrightOpentelemetryReporter - Trace Zip", () => {
	let outputDir: string;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(async () => {
		// Clean up test output directory
		if (outputDir && existsSync(outputDir)) {
			rmSync(outputDir, { recursive: true, force: true });
		}
	});

	describe("single test case", () => {
		it("creates a zip file with trace data and screenshots from trace attachment", async () => {
			outputDir = createTestOutputDir("single-test");

			const testId = "abc123def";
			const pageGuid = "page@f06f11f7c14d6ce1060d47d79f05c154";
			const testLocation = {
				file: "/Users/test/project/test-e2e/example.spec.ts",
				line: 10,
			};

			// Create mock Playwright trace ZIP with screenshots
			const screenshotTimestamp1 = DEFAULT_START_TIME.getTime() + 600;
			const screenshotTimestamp2 = DEFAULT_START_TIME.getTime() + 800;

			const traceZipPath = await createMockPlaywrightTraceZip(outputDir, [
				{ pageGuid, timestamp: screenshotTimestamp1 },
				{ pageGuid, timestamp: screenshotTimestamp2 },
			]);

			// Set up reporter with storeTraceZip enabled
			const reporter = new PlaywrightOpentelemetryReporter({
				...DEFAULT_REPORTER_OPTIONS,
				storeTraceZip: true,
			});

			// Build test objects
			const config = buildConfig({ rootDir: DEFAULT_ROOT_DIR });
			const testCase = buildTestCase(
				{
					id: testId,
					title: "example test with screenshot",
					titlePath: [
						"",
						"chromium",
						"example.spec.ts",
						"example test with screenshot",
					],
					location: testLocation,
				},
				outputDir,
			);

			// Build test result with trace attachment (this is what Playwright provides)
			const testResult = buildTestResult(
				{
					status: "passed",
					duration: 2000,
					steps: [
						{
							title: "navigate to page",
							duration: 500,
						},
						{
							title: "take screenshot",
							duration: 100,
						},
					],
					attachments: [
						{
							name: "trace",
							contentType: "application/zip",
							path: traceZipPath,
						},
					],
				},
				DEFAULT_START_TIME,
			);

			// Create mock suite
			const mockSuite = {
				allTests: () => [testCase],
			} as Suite;

			// Execute reporter lifecycle
			reporter.onBegin(config, mockSuite);
			reporter.onTestBegin(testCase, testResult);

			// Execute step hooks
			for (const step of testResult.steps) {
				reporter.onStepBegin(testCase, testResult, step);
				reporter.onStepEnd(testCase, testResult, step);
			}

			await reporter.onTestEnd(testCase, testResult);
			await reporter.onEnd({} as FullResult);

			// Verify sendSpans was called with the trace data
			expect(sendSpans).toHaveBeenCalledTimes(1);

			// Verify the zip file was created with correct name format
			// Format: {file.spec}:{linenumber}-{testId}-pw-otel.zip
			const expectedZipName = `example.spec.ts:10-${testId}-pw-otel.zip`;
			const expectedZipPath = path.join(outputDir, expectedZipName);

			expect(existsSync(expectedZipPath)).toBe(true);

			// Read and verify zip contents
			const zipEntries = await readZipEntries(expectedZipPath);

			// Verify test.json exists at root
			const testInfoContent = zipEntries.get("test.json") as string;
			expect(testInfoContent).toBeDefined();

			// Verify test.json structure
			const testInfo = JSON.parse(testInfoContent);
			expect(testInfo.name).toBe("example test with screenshot");
			expect(testInfo.describes).toEqual([]);
			expect(testInfo.file).toBe("example.spec.ts");
			expect(testInfo.line).toBe(10);
			expect(testInfo.status).toBe("passed");
			expect(testInfo.traceId).toMatch(/^[0-9a-f]{32}$/);
			expect(testInfo.startTimeUnixNano).toMatch(/^\d+$/);
			expect(testInfo.endTimeUnixNano).toMatch(/^\d+$/);

			// Verify timing - endTime should be startTime + duration (2000ms = 2000000000ns)
			const startNano = BigInt(testInfo.startTimeUnixNano);
			const endNano = BigInt(testInfo.endTimeUnixNano);
			expect(endNano - startNano).toBe(BigInt(2000 * 1_000_000));

			// Verify opentelemetry-protocol/playwright-opentelemetry.json exists
			const traceContent = zipEntries.get(
				"opentelemetry-protocol/playwright-opentelemetry.json",
			) as string;
			expect(traceContent).toBeDefined();

			// Verify the trace JSON contains expected data
			const traceData = JSON.parse(traceContent);

			// Should have resourceSpans with the test's spans
			expect(traceData).toHaveProperty("resourceSpans");
			expect(traceData.resourceSpans).toHaveLength(1);
			expect(traceData.resourceSpans[0].scopeSpans[0].spans).toBeDefined();

			// The spans should include the test span and step spans
			const spans = traceData.resourceSpans[0].scopeSpans[0].spans;
			expect(spans.length).toBeGreaterThanOrEqual(1);

			// Verify test span has correct trace ID
			const testSpan = spans.find(
				(s: { name: string }) => s.name === "playwright.test",
			);
			expect(testSpan).toBeDefined();
			expect(testSpan.traceId).toMatch(/^[0-9a-f]{32}$/);

			// Verify test.json traceId matches the test span's traceId
			expect(testInfo.traceId).toBe(testSpan.traceId);

			// Verify screenshots folder exists with correct files
			const screenshotFiles = Array.from(zipEntries.keys()).filter((f) =>
				f.startsWith("screenshots/"),
			);
			expect(screenshotFiles).toHaveLength(2);

			// Verify screenshot naming convention: {pageGuid}-{timestamp}.jpeg
			for (const filepath of screenshotFiles) {
				const filename = path.basename(filepath);
				expect(filename).toMatch(new RegExp(`^${pageGuid}-\\d+\\.jpeg$`));
			}
		});

		it("creates zip without screenshots when trace attachment is missing", async () => {
			outputDir = createTestOutputDir("no-trace-attachment");

			const testId = "no-trace-123";
			const testLocation = {
				file: "/Users/test/project/test-e2e/simple.spec.ts",
				line: 5,
			};

			// Set up reporter with storeTraceZip enabled
			const reporter = new PlaywrightOpentelemetryReporter({
				...DEFAULT_REPORTER_OPTIONS,
				storeTraceZip: true,
			});

			// Build test objects - no trace attachment
			const config = buildConfig({ rootDir: DEFAULT_ROOT_DIR });
			const testCase = buildTestCase(
				{
					id: testId,
					title: "test without tracing",
					titlePath: ["", "chromium", "simple.spec.ts", "test without tracing"],
					location: testLocation,
				},
				outputDir,
			);
			const testResult = buildTestResult(
				{
					status: "passed",
					duration: 1000,
					steps: [],
					// No attachments - tracing not enabled
				},
				DEFAULT_START_TIME,
			);

			// Create mock suite
			const mockSuite = {
				allTests: () => [testCase],
			} as Suite;

			// Execute reporter lifecycle
			reporter.onBegin(config, mockSuite);
			reporter.onTestBegin(testCase, testResult);
			await reporter.onTestEnd(testCase, testResult);
			await reporter.onEnd({} as FullResult);

			// Verify the zip file was created
			const expectedZipName = `simple.spec.ts:5-${testId}-pw-otel.zip`;
			const expectedZipPath = path.join(outputDir, expectedZipName);
			expect(existsSync(expectedZipPath)).toBe(true);

			// Read and verify zip contents
			const zipEntries = await readZipEntries(expectedZipPath);

			// Should have test.json and trace JSON, but no screenshots
			expect(zipEntries.has("test.json")).toBe(true);
			expect(
				zipEntries.has("opentelemetry-protocol/playwright-opentelemetry.json"),
			).toBe(true);

			// No screenshots should be present
			const screenshotFiles = Array.from(zipEntries.keys()).filter((f) =>
				f.startsWith("screenshots/"),
			);
			expect(screenshotFiles).toHaveLength(0);
		});

		it("creates test.json with describes array from titlePath", async () => {
			outputDir = createTestOutputDir("test-with-describes");

			const testId = "describe-test-123";
			const testLocation = {
				file: "/Users/test/project/test-e2e/homepage/login.spec.ts",
				line: 9,
			};

			// Set up reporter with storeTraceZip enabled
			const reporter = new PlaywrightOpentelemetryReporter({
				...DEFAULT_REPORTER_OPTIONS,
				storeTraceZip: true,
			});

			// Build test with describe blocks in titlePath
			// titlePath format: ['', 'project', 'filename', ...describes, 'testname']
			const config = buildConfig({ rootDir: DEFAULT_ROOT_DIR });
			const testCase = buildTestCase(
				{
					id: testId,
					title: "User can log in to the homepage",
					titlePath: [
						"",
						"chromium",
						"login.spec.ts",
						"Authentication",
						"When a user is logged out",
						"User can log in to the homepage",
					],
					location: testLocation,
				},
				outputDir,
			);
			const testResult = buildTestResult(
				{
					status: "passed",
					duration: 1500,
					steps: [],
				},
				DEFAULT_START_TIME,
			);

			// Create mock suite
			const mockSuite = {
				allTests: () => [testCase],
			} as Suite;

			// Execute reporter lifecycle
			reporter.onBegin(config, mockSuite);
			reporter.onTestBegin(testCase, testResult);
			await reporter.onTestEnd(testCase, testResult);
			await reporter.onEnd({} as FullResult);

			// Find and read the zip file
			const expectedZipName = `login.spec.ts:9-${testId}-pw-otel.zip`;
			const expectedZipPath = path.join(outputDir, expectedZipName);
			expect(existsSync(expectedZipPath)).toBe(true);

			const zipEntries = await readZipEntries(expectedZipPath);

			// Verify test.json
			const testInfoContent = zipEntries.get("test.json") as string;
			expect(testInfoContent).toBeDefined();

			const testInfo = JSON.parse(testInfoContent);
			expect(testInfo.name).toBe("User can log in to the homepage");
			expect(testInfo.describes).toEqual([
				"Authentication",
				"When a user is logged out",
			]);
			expect(testInfo.file).toBe("homepage/login.spec.ts");
			expect(testInfo.line).toBe(9);
			expect(testInfo.status).toBe("passed");
		});

		it("creates test.json with failed status for failed tests", async () => {
			outputDir = createTestOutputDir("test-failed");

			const testId = "failed-test-123";
			const testLocation = {
				file: "/Users/test/project/test-e2e/failing.spec.ts",
				line: 15,
			};

			// Set up reporter with storeTraceZip enabled
			const reporter = new PlaywrightOpentelemetryReporter({
				...DEFAULT_REPORTER_OPTIONS,
				storeTraceZip: true,
			});

			const config = buildConfig({ rootDir: DEFAULT_ROOT_DIR });
			const testCase = buildTestCase(
				{
					id: testId,
					title: "should fail gracefully",
					titlePath: [
						"",
						"chromium",
						"failing.spec.ts",
						"should fail gracefully",
					],
					location: testLocation,
				},
				outputDir,
			);
			const testResult = buildTestResult(
				{
					status: "failed",
					duration: 500,
					steps: [],
				},
				DEFAULT_START_TIME,
			);

			// Create mock suite
			const mockSuite = {
				allTests: () => [testCase],
			} as Suite;

			// Execute reporter lifecycle
			reporter.onBegin(config, mockSuite);
			reporter.onTestBegin(testCase, testResult);
			await reporter.onTestEnd(testCase, testResult);
			await reporter.onEnd({} as FullResult);

			// Find and read the zip file
			const expectedZipName = `failing.spec.ts:15-${testId}-pw-otel.zip`;
			const expectedZipPath = path.join(outputDir, expectedZipName);
			expect(existsSync(expectedZipPath)).toBe(true);

			const zipEntries = await readZipEntries(expectedZipPath);

			// Verify test.json has failed status
			const testInfoContent = zipEntries.get("test.json") as string;
			const testInfo = JSON.parse(testInfoContent);
			expect(testInfo.status).toBe("failed");
		});
	});

	describe("multiple test cases", () => {
		it("creates separate zip files for each test with screenshots from their respective traces", async () => {
			outputDir = createTestOutputDir("multiple-tests");

			// Define two tests with different pageGuids
			const test1 = {
				id: "test-id-001",
				pageGuid: "page@a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
				title: "first test",
				location: {
					file: "/Users/test/project/test-e2e/multi.spec.ts",
					line: 5,
				},
			};

			const test2 = {
				id: "test-id-002",
				pageGuid: "page@1234567890abcdef1234567890abcdef",
				title: "second test",
				location: {
					file: "/Users/test/project/test-e2e/multi.spec.ts",
					line: 20,
				},
			};

			// Create mock trace ZIPs for each test
			const test1TraceDir = path.join(outputDir, "trace1");
			const test2TraceDir = path.join(outputDir, "trace2");
			mkdirSync(test1TraceDir, { recursive: true });
			mkdirSync(test2TraceDir, { recursive: true });

			const screenshot1Timestamp = DEFAULT_START_TIME.getTime() + 500;
			const trace1ZipPath = await createMockPlaywrightTraceZip(test1TraceDir, [
				{ pageGuid: test1.pageGuid, timestamp: screenshot1Timestamp },
			]);

			const screenshot2Timestamp1 = DEFAULT_START_TIME.getTime() + 2500;
			const screenshot2Timestamp2 = DEFAULT_START_TIME.getTime() + 2700;
			const screenshot2Timestamp3 = DEFAULT_START_TIME.getTime() + 3000;
			const trace2ZipPath = await createMockPlaywrightTraceZip(test2TraceDir, [
				{ pageGuid: test2.pageGuid, timestamp: screenshot2Timestamp1 },
				{ pageGuid: test2.pageGuid, timestamp: screenshot2Timestamp2 },
				{ pageGuid: test2.pageGuid, timestamp: screenshot2Timestamp3 },
			]);

			// Set up reporter with storeTraceZip enabled
			const reporter = new PlaywrightOpentelemetryReporter({
				...DEFAULT_REPORTER_OPTIONS,
				storeTraceZip: true,
			});

			// Build test objects
			const config = buildConfig({ rootDir: DEFAULT_ROOT_DIR });

			const testCase1 = buildTestCase(
				{
					id: test1.id,
					title: test1.title,
					titlePath: ["", "chromium", "multi.spec.ts", test1.title],
					location: test1.location,
				},
				outputDir,
			);

			const testCase2 = buildTestCase(
				{
					id: test2.id,
					title: test2.title,
					titlePath: ["", "chromium", "multi.spec.ts", test2.title],
					location: test2.location,
				},
				outputDir,
			);

			const testResult1 = buildTestResult(
				{
					status: "passed",
					duration: 1500,
					steps: [{ title: "step 1", duration: 100 }],
					attachments: [
						{
							name: "trace",
							contentType: "application/zip",
							path: trace1ZipPath,
						},
					],
				},
				DEFAULT_START_TIME,
			);

			const testResult2 = buildTestResult(
				{
					status: "passed",
					duration: 1800,
					steps: [{ title: "step 2", duration: 150 }],
					attachments: [
						{
							name: "trace",
							contentType: "application/zip",
							path: trace2ZipPath,
						},
					],
				},
				new Date(DEFAULT_START_TIME.getTime() + 2000), // Second test starts after first
			);

			// Create mock suite with both tests
			const mockSuite = {
				allTests: () => [testCase1, testCase2],
			} as Suite;

			// Execute reporter lifecycle
			reporter.onBegin(config, mockSuite);

			// --- Test 1 execution ---
			reporter.onTestBegin(testCase1, testResult1);

			for (const step of testResult1.steps) {
				reporter.onStepBegin(testCase1, testResult1, step);
				reporter.onStepEnd(testCase1, testResult1, step);
			}

			await reporter.onTestEnd(testCase1, testResult1);

			// --- Test 2 execution ---
			reporter.onTestBegin(testCase2, testResult2);

			for (const step of testResult2.steps) {
				reporter.onStepBegin(testCase2, testResult2, step);
				reporter.onStepEnd(testCase2, testResult2, step);
			}

			await reporter.onTestEnd(testCase2, testResult2);

			// End the run
			await reporter.onEnd({} as FullResult);

			// Verify sendSpans was called
			expect(sendSpans).toHaveBeenCalledTimes(1);

			// --- Verify Test 1 zip file ---
			const expectedZip1Name = `multi.spec.ts:5-${test1.id}-pw-otel.zip`;
			const expectedZip1Path = path.join(outputDir, expectedZip1Name);

			expect(existsSync(expectedZip1Path)).toBe(true);

			const zip1Entries = await readZipEntries(expectedZip1Path);

			// Verify trace file for test 1
			const trace1Content = zip1Entries.get(
				"opentelemetry-protocol/playwright-opentelemetry.json",
			) as string;
			expect(trace1Content).toBeDefined();

			const trace1Data = JSON.parse(trace1Content);

			// Verify test 1 trace has spans only for test 1
			const spans1 = trace1Data.resourceSpans[0].scopeSpans[0].spans;
			const testSpan1 = spans1.find(
				(s: { name: string }) => s.name === "playwright.test",
			);
			expect(testSpan1).toBeDefined();

			// Verify test 1 zip contains only its screenshots (1 screenshot)
			const screenshots1 = Array.from(zip1Entries.keys()).filter((f) =>
				f.startsWith("screenshots/"),
			);

			expect(screenshots1).toHaveLength(1);
			expect(screenshots1[0]).toMatch(
				new RegExp(`screenshots/${test1.pageGuid}-\\d+\\.jpeg$`),
			);
			// Ensure no screenshots from test 2 leaked into test 1's zip
			expect(screenshots1.some((f) => f.includes(test2.pageGuid))).toBe(false);

			// --- Verify Test 2 zip file ---
			const expectedZip2Name = `multi.spec.ts:20-${test2.id}-pw-otel.zip`;
			const expectedZip2Path = path.join(outputDir, expectedZip2Name);

			expect(existsSync(expectedZip2Path)).toBe(true);

			const zip2Entries = await readZipEntries(expectedZip2Path);

			// Verify trace file for test 2
			const trace2Content = zip2Entries.get(
				"opentelemetry-protocol/playwright-opentelemetry.json",
			) as string;
			expect(trace2Content).toBeDefined();

			const trace2Data = JSON.parse(trace2Content);

			// Verify test 2 trace has spans only for test 2
			const spans2 = trace2Data.resourceSpans[0].scopeSpans[0].spans;
			const testSpan2 = spans2.find(
				(s: { name: string }) => s.name === "playwright.test",
			);
			expect(testSpan2).toBeDefined();

			// Each test should have a different trace ID
			expect(testSpan1.traceId).not.toBe(testSpan2.traceId);

			// Verify test 2 zip contains only its screenshots (3 screenshots)
			const screenshots2 = Array.from(zip2Entries.keys()).filter((f) =>
				f.startsWith("screenshots/"),
			);

			expect(screenshots2).toHaveLength(3);
			for (const filepath of screenshots2) {
				const filename = path.basename(filepath);
				expect(filename).toMatch(new RegExp(`^${test2.pageGuid}-\\d+\\.jpeg$`));
			}
			// Ensure no screenshots from test 1 leaked into test 2's zip
			expect(screenshots2.some((f) => f.includes(test1.pageGuid))).toBe(false);
		});

		it("handles tests with multiple pages correctly - all screenshots in same trace", async () => {
			outputDir = createTestOutputDir("multi-page-test");

			const testId = "test-multi-page";
			// Two different pages in the same test
			const page1Guid = "page@aabbccdd11223344aabbccdd11223344";
			const page2Guid = "page@55667788aabbccdd55667788aabbccdd";
			const testLocation = {
				file: "/Users/test/project/test-e2e/popup.spec.ts",
				line: 15,
			};

			// Create mock trace ZIP with screenshots from both pages
			const mainPageScreenshot = DEFAULT_START_TIME.getTime() + 600;
			const popupScreenshot1 = DEFAULT_START_TIME.getTime() + 1200;
			const popupScreenshot2 = DEFAULT_START_TIME.getTime() + 1500;

			const traceZipPath = await createMockPlaywrightTraceZip(outputDir, [
				{ pageGuid: page1Guid, timestamp: mainPageScreenshot },
				{ pageGuid: page2Guid, timestamp: popupScreenshot1 },
				{ pageGuid: page2Guid, timestamp: popupScreenshot2 },
			]);

			// Set up reporter with storeTraceZip enabled
			const reporter = new PlaywrightOpentelemetryReporter({
				...DEFAULT_REPORTER_OPTIONS,
				storeTraceZip: true,
			});

			// Build test objects
			const config = buildConfig({ rootDir: DEFAULT_ROOT_DIR });
			const testCase = buildTestCase(
				{
					id: testId,
					title: "test with popup",
					titlePath: ["", "chromium", "popup.spec.ts", "test with popup"],
					location: testLocation,
				},
				outputDir,
			);
			const testResult = buildTestResult(
				{
					status: "passed",
					duration: 3000,
					steps: [
						{ title: "open main page", duration: 500 },
						{ title: "trigger popup", duration: 200 },
						{ title: "interact with popup", duration: 300 },
					],
					attachments: [
						{
							name: "trace",
							contentType: "application/zip",
							path: traceZipPath,
						},
					],
				},
				DEFAULT_START_TIME,
			);

			// Create mock suite
			const mockSuite = {
				allTests: () => [testCase],
			} as Suite;

			// Execute reporter lifecycle
			reporter.onBegin(config, mockSuite);
			reporter.onTestBegin(testCase, testResult);

			for (const step of testResult.steps) {
				reporter.onStepBegin(testCase, testResult, step);
				reporter.onStepEnd(testCase, testResult, step);
			}

			await reporter.onTestEnd(testCase, testResult);
			await reporter.onEnd({} as FullResult);

			// Verify the zip file
			const expectedZipName = `popup.spec.ts:15-${testId}-pw-otel.zip`;
			const expectedZipPath = path.join(outputDir, expectedZipName);

			expect(existsSync(expectedZipPath)).toBe(true);

			const zipEntries = await readZipEntries(expectedZipPath);

			// Verify screenshots folder contains all screenshots from both pages
			const screenshots = Array.from(zipEntries.keys()).filter((f) =>
				f.startsWith("screenshots/"),
			);

			expect(screenshots).toHaveLength(3);

			// Verify we have screenshots from both pages
			const page1Screenshots = screenshots.filter((f) => f.includes(page1Guid));
			const page2Screenshots = screenshots.filter((f) => f.includes(page2Guid));

			expect(page1Screenshots).toHaveLength(1);
			expect(page2Screenshots).toHaveLength(2);
		});
	});
});
