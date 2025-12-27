import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FullResult, Suite } from "@playwright/test/reporter";
import {
	ZipReader,
	BlobReader,
	TextWriter,
	Uint8ArrayWriter,
} from "@zip.js/zip.js";
import {
	copyScreenshotForTest,
	getScreenshotsDir,
	PW_OTEL_DIR,
} from "../src/shared/trace-files";
import {
	PlaywrightOpentelemetryReporter,
	buildConfig,
	buildTestCase,
	buildTestResult,
	DEFAULT_REPORTER_OPTIONS,
	DEFAULT_ROOT_DIR,
	DEFAULT_START_TIME,
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
 * Simulates a screenshot being captured and copied to the test's screenshots directory.
 * In real execution, Playwright writes screenshots to the test output directory
 * and the reporter's file watcher copies them to the test-specific screenshots directory.
 *
 * This simulates the final state after the file watcher has processed the screenshot.
 *
 * Playwright screenshot naming convention: {pageGuid}-{timestamp}.jpeg
 * where pageGuid is the full page._guid like "page@f06f11f7c14d6ce1060d47d79f05c154"
 */
function simulateScreenshotCapture(
	outputDir: string,
	testId: string,
	pageGuid: string,
	timestamp: number,
): string {
	const screenshotsDir = getScreenshotsDir(outputDir, testId);
	mkdirSync(screenshotsDir, { recursive: true });

	// Screenshot naming convention: {pageGuid}-{timestamp}.jpeg
	const screenshotName = `${pageGuid}-${timestamp}.jpeg`;
	const screenshotPath = path.join(screenshotsDir, screenshotName);

	// Write a minimal valid JPEG (just enough to be recognized as an image)
	const minimalJpeg = Buffer.from([
		0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
		0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
	]);
	writeFileSync(screenshotPath, minimalJpeg);

	return screenshotPath;
}

/**
 * Maps page GUIDs to test IDs.
 * This simulates the fixture storing this mapping when a page is used in a test.
 */
interface PageTestMapping {
	testId: string;
	pageGuid: string;
}

/**
 * Simulates the fixture recording a page-to-test mapping.
 * In real execution, this happens in the page fixture when it logs:
 * `page: ${testId} ${page._guid}`
 */
function recordPageTestMapping(
	outputDir: string,
	mapping: PageTestMapping,
): void {
	const otelDir = path.join(outputDir, PW_OTEL_DIR);
	mkdirSync(otelDir, { recursive: true });

	const mappingFile = path.join(otelDir, "page-test-mappings.json");

	let mappings: PageTestMapping[] = [];
	if (existsSync(mappingFile)) {
		const content = JSON.parse(readFileSync(mappingFile, "utf-8"));
		mappings = content;
	}

	mappings.push(mapping);
	writeFileSync(mappingFile, JSON.stringify(mappings, null, 2));
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

describe("copyScreenshotForTest", () => {
	let outputDir: string;

	afterEach(async () => {
		if (outputDir && existsSync(outputDir)) {
			rmSync(outputDir, { recursive: true, force: true });
		}
	});

	it("copies screenshot when pageGuid matches mapping with page@ prefix", () => {
		outputDir = createTestOutputDir("copy-screenshot-test");

		const testId = "test-abc-123";
		// Realistic pageGuid format from Playwright's page._guid property
		const pageGuid = "page@f06f11f7c14d6ce1060d47d79f05c154";
		const timestamp = Date.now();
		const filename = `page@f06f11f7c14d6ce1060d47d79f05c154-${timestamp}.jpeg`;

		// Create the page-test mapping (as the fixture would do)
		recordPageTestMapping(outputDir, { testId, pageGuid });

		// Create a source screenshot file (simulating what Playwright writes)
		const sourceDir = path.join(
			outputDir,
			".playwright-artifacts",
			"traces",
			"resources",
		);
		mkdirSync(sourceDir, { recursive: true });
		const sourcePath = path.join(sourceDir, filename);
		const minimalJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // Minimal JPEG
		writeFileSync(sourcePath, minimalJpeg);

		// Call copyScreenshotForTest with the full pageGuid (including page@ prefix)
		// This is what the file watcher should extract from the filename
		const result = copyScreenshotForTest(
			outputDir,
			pageGuid,
			sourcePath,
			filename,
		);

		expect(result).toBe(true);

		// Verify the screenshot was copied to the test's screenshots directory
		const screenshotsDir = getScreenshotsDir(outputDir, testId);
		const copiedPath = path.join(screenshotsDir, filename);
		expect(existsSync(copiedPath)).toBe(true);
	});

	it("returns false when pageGuid does not match any mapping", () => {
		outputDir = createTestOutputDir("copy-screenshot-no-match");

		const testId = "test-abc-123";
		const mappedPageGuid = "page@f06f11f7c14d6ce1060d47d79f05c154";
		const differentPageGuid = "page@0000000000000000000000000000000";
		const timestamp = Date.now();
		const filename = `page@0000000000000000000000000000000-${timestamp}.jpeg`;

		// Create mapping for a different page
		recordPageTestMapping(outputDir, { testId, pageGuid: mappedPageGuid });

		// Create source file
		const sourceDir = path.join(outputDir, ".playwright-artifacts");
		mkdirSync(sourceDir, { recursive: true });
		const sourcePath = path.join(sourceDir, filename);
		writeFileSync(sourcePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

		// Try to copy with non-matching pageGuid
		const result = copyScreenshotForTest(
			outputDir,
			differentPageGuid,
			sourcePath,
			filename,
		);

		expect(result).toBe(false);
	});

	it("returns false when pageGuid is missing the page@ prefix", () => {
		outputDir = createTestOutputDir("copy-screenshot-no-prefix");

		const testId = "test-abc-123";
		// Mapping stores the full pageGuid with prefix
		const fullPageGuid = "page@f06f11f7c14d6ce1060d47d79f05c154";
		// But if we only extract the hex part (bug scenario), it won't match
		const hexOnlyGuid = "f06f11f7c14d6ce1060d47d79f05c154";
		const timestamp = Date.now();
		const filename = `page@f06f11f7c14d6ce1060d47d79f05c154-${timestamp}.jpeg`;

		// Create mapping with full pageGuid
		recordPageTestMapping(outputDir, { testId, pageGuid: fullPageGuid });

		// Create source file
		const sourceDir = path.join(outputDir, ".playwright-artifacts");
		mkdirSync(sourceDir, { recursive: true });
		const sourcePath = path.join(sourceDir, filename);
		writeFileSync(sourcePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

		// Try to copy with hex-only pageGuid (simulating the bug)
		const result = copyScreenshotForTest(
			outputDir,
			hexOnlyGuid,
			sourcePath,
			filename,
		);

		// This should return false because the pageGuid doesn't match
		expect(result).toBe(false);
	});
});

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
		it("creates a zip file with trace data and screenshots for a single test", async () => {
			outputDir = createTestOutputDir("single-test");

			const testId = "abc123def";
			// Use realistic pageGuid format matching Playwright's internal _guid property
			// Format: page@{32-char-hex}
			const pageGuid = "page@f06f11f7c14d6ce1060d47d79f05c154";
			const testLocation = {
				file: "/Users/test/project/test-e2e/example.spec.ts",
				line: 10,
			};

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
				},
				DEFAULT_START_TIME,
			);

			// Create mock suite
			const mockSuite = {
				allTests: () => [testCase],
			} as Suite;

			// Execute reporter lifecycle
			reporter.onBegin(config, mockSuite);
			reporter.onTestBegin(testCase);

			// Simulate the fixture recording the page-test mapping
			// This would happen in the real page fixture when the page is used
			recordPageTestMapping(outputDir, {
				testId,
				pageGuid,
			});

			// Simulate screenshots being captured during the test
			// These would be written by Playwright and copied by the file watcher
			const screenshotTimestamp1 = DEFAULT_START_TIME.getTime() + 600;
			const screenshotTimestamp2 = DEFAULT_START_TIME.getTime() + 800;

			simulateScreenshotCapture(
				outputDir,
				testId,
				pageGuid,
				screenshotTimestamp1,
			);
			simulateScreenshotCapture(
				outputDir,
				testId,
				pageGuid,
				screenshotTimestamp2,
			);

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

			// Verify oltp-traces/pw-reporter-trace.json exists
			const traceContent = zipEntries.get(
				"oltp-traces/pw-reporter-trace.json",
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
	});

	describe("multiple test cases", () => {
		it("creates separate zip files for each test with correct screenshots", async () => {
			outputDir = createTestOutputDir("multiple-tests");

			// Define two tests with realistic pageGuid format matching Playwright's internal _guid
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
				},
				DEFAULT_START_TIME,
			);

			const testResult2 = buildTestResult(
				{
					status: "passed",
					duration: 1800,
					steps: [{ title: "step 2", duration: 150 }],
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
			reporter.onTestBegin(testCase1);

			// Record page mapping for test 1
			recordPageTestMapping(outputDir, {
				testId: test1.id,
				pageGuid: test1.pageGuid,
			});

			// Simulate screenshots for test 1
			const screenshot1Timestamp = DEFAULT_START_TIME.getTime() + 500;
			simulateScreenshotCapture(
				outputDir,
				test1.id,
				test1.pageGuid,
				screenshot1Timestamp,
			);

			for (const step of testResult1.steps) {
				reporter.onStepBegin(testCase1, testResult1, step);
				reporter.onStepEnd(testCase1, testResult1, step);
			}

			await reporter.onTestEnd(testCase1, testResult1);

			// --- Test 2 execution ---
			reporter.onTestBegin(testCase2);

			// Record page mapping for test 2
			recordPageTestMapping(outputDir, {
				testId: test2.id,
				pageGuid: test2.pageGuid,
			});

			// Simulate screenshots for test 2 (multiple screenshots)
			const screenshot2Timestamp1 = DEFAULT_START_TIME.getTime() + 2500;
			const screenshot2Timestamp2 = DEFAULT_START_TIME.getTime() + 2700;
			const screenshot2Timestamp3 = DEFAULT_START_TIME.getTime() + 3000;

			simulateScreenshotCapture(
				outputDir,
				test2.id,
				test2.pageGuid,
				screenshot2Timestamp1,
			);
			simulateScreenshotCapture(
				outputDir,
				test2.id,
				test2.pageGuid,
				screenshot2Timestamp2,
			);
			simulateScreenshotCapture(
				outputDir,
				test2.id,
				test2.pageGuid,
				screenshot2Timestamp3,
			);

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
				"oltp-traces/pw-reporter-trace.json",
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
				"oltp-traces/pw-reporter-trace.json",
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

		it("handles tests with multiple pages correctly", async () => {
			outputDir = createTestOutputDir("multi-page-test");

			const testId = "test-multi-page";
			// Use realistic pageGuid format matching Playwright's internal _guid
			const page1Guid = "page@aabbccdd11223344aabbccdd11223344";
			const page2Guid = "page@55667788aabbccdd55667788aabbccdd";
			const testLocation = {
				file: "/Users/test/project/test-e2e/popup.spec.ts",
				line: 15,
			};

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
				},
				DEFAULT_START_TIME,
			);

			// Create mock suite
			const mockSuite = {
				allTests: () => [testCase],
			} as Suite;

			// Execute reporter lifecycle
			reporter.onBegin(config, mockSuite);
			reporter.onTestBegin(testCase);

			// Record both page mappings for this test
			recordPageTestMapping(outputDir, {
				testId,
				pageGuid: page1Guid,
			});
			recordPageTestMapping(outputDir, {
				testId,
				pageGuid: page2Guid,
			});

			// Simulate screenshots from both pages
			const mainPageScreenshot = DEFAULT_START_TIME.getTime() + 600;
			const popupScreenshot1 = DEFAULT_START_TIME.getTime() + 1200;
			const popupScreenshot2 = DEFAULT_START_TIME.getTime() + 1500;

			simulateScreenshotCapture(
				outputDir,
				testId,
				page1Guid,
				mainPageScreenshot,
			);
			simulateScreenshotCapture(outputDir, testId, page2Guid, popupScreenshot1);
			simulateScreenshotCapture(outputDir, testId, page2Guid, popupScreenshot2);

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
