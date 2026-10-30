import { existsSync, mkdirSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { FullResult, Suite, TestResult } from "@playwright/test/reporter";
import {
	BlobReader,
	TextWriter,
	Uint8ArrayWriter,
	ZipReader,
} from "@zip.js/zip.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildConfig,
	buildTestCase,
	buildTestResult,
	DEFAULT_PLAYWRIGHT_OPENTELEMETRY_CONFIG,
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
import {
	createScreenshotsZip,
	SCREENSHOTS_ATTACHMENT_NAME,
} from "../src/shared/screenshots-zip";
import {
	FIXTURE_SPANS_ATTACHMENT_NAME,
	TRACE_CONTEXT_ATTACHMENT_NAME,
} from "../src/fixture/trace-context";

/**
 * Helper to create a unique test output directory
 */
function createTestOutputDir(testName: string): string {
	const outputDir = `/tmp/trace-zip-test-${testName}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
 * Creates the attachments of a kept test: the screenshots ZIP the fixture
 * attaches, and Playwright's trace attachment, whose presence keeps the test.
 */
async function createScreenshotsAttachments(
	outputDir: string,
	screenshots: Array<{ pageId: string; timestamp: number }>,
): Promise<TestResult["attachments"]> {
	const screenshotsZipPath = path.join(outputDir, "screenshots.zip");
	const zip = await createScreenshotsZip(
		screenshots.map(({ pageId, timestamp }) => ({
			pageId,
			timestamp,
			file: `${pageId}-${timestamp}.jpeg`,
			contentType: "image/jpeg",
			blob: new Blob([new Uint8Array(createMinimalJpeg())]),
		})),
	);
	await fs.writeFile(screenshotsZipPath, Buffer.from(await zip.arrayBuffer()));

	return [
		{
			name: "trace",
			contentType: "application/zip",
			path: path.join(outputDir, "trace.zip"),
		},
		{
			name: SCREENSHOTS_ATTACHMENT_NAME,
			contentType: "application/zip",
			path: screenshotsZipPath,
		},
	];
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
		it("creates a zip file with trace data and screenshots from the fixture's attachment", async () => {
			outputDir = createTestOutputDir("single-test");

			const testId = "abc123def";
			const pageId = "page-0";
			const testLocation = {
				file: "/Users/test/project/test-e2e/example.spec.ts",
				line: 10,
			};

			const screenshotTimestamp1 = DEFAULT_START_TIME.getTime() + 600;
			const screenshotTimestamp2 = DEFAULT_START_TIME.getTime() + 800;

			const attachments = await createScreenshotsAttachments(outputDir, [
				{ pageId, timestamp: screenshotTimestamp1 },
				{ pageId, timestamp: screenshotTimestamp2 },
			]);

			const playwrightOpentelemetry = {
				...DEFAULT_PLAYWRIGHT_OPENTELEMETRY_CONFIG,
				storeTraceZip: true,
			};
			const reporter = new PlaywrightOpentelemetryReporter();

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
				playwrightOpentelemetry,
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
					attachments,
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

			reporter.onTestEnd(testCase, testResult);
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

			// Verify traces/playwright-opentelemetry.json exists
			const traceContent = zipEntries.get(
				"traces/playwright-opentelemetry.json",
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

			expect(testSpan.attributes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						key: "test.case.title",
						value: { stringValue: "example test with screenshot" },
					}),
					expect.objectContaining({
						key: "playwright.test.status",
						value: { stringValue: "passed" },
					}),
				]),
			);

			// Verify screenshots folder exists with correct files
			const screenshotFiles = Array.from(zipEntries.keys()).filter((f) =>
				f.startsWith("screenshots/"),
			);
			expect(screenshotFiles).toHaveLength(2);
			expect(JSON.parse(zipEntries.get("manifest.json") as string)).toEqual({
				version: 3,
				screenshots: screenshotFiles
					.map((filepath) => {
						const filename = path.basename(filepath);
						return {
							timestamp: Number.parseInt(
								filename.replace(/^.*-/, "").replace(/\.jpeg$/, ""),
								10,
							),
							file: filename,
							path: filepath,
							contentType: "image/jpeg",
							pageId,
						};
					})
					.sort((a, b) => a.timestamp - b.timestamp),
			});

			// Verify screenshot naming convention: {pageId}-{timestamp}.jpeg
			for (const filepath of screenshotFiles) {
				const filename = path.basename(filepath);
				expect(filename).toMatch(new RegExp(`^${pageId}-\\d+\\.jpeg$`));
			}
		});

		it("does not create zip when Playwright did not retain a trace attachment", async () => {
			outputDir = createTestOutputDir("no-trace-attachment");

			const testId = "no-trace-123";
			const testLocation = {
				file: "/Users/test/project/test-e2e/simple.spec.ts",
				line: 5,
			};

			const playwrightOpentelemetry = {
				...DEFAULT_PLAYWRIGHT_OPENTELEMETRY_CONFIG,
				storeTraceZip: true,
			};
			const reporter = new PlaywrightOpentelemetryReporter();

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
				playwrightOpentelemetry,
			);
			const testResult = buildTestResult(
				{
					status: "passed",
					duration: 1000,
					steps: [],
					attachments: [],
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
			reporter.onTestEnd(testCase, testResult);
			await reporter.onEnd({} as FullResult);

			// Verify no reporter trace zip was created
			const expectedZipName = `simple.spec.ts:5-${testId}-pw-otel.zip`;
			const expectedZipPath = path.join(outputDir, expectedZipName);
			expect(existsSync(expectedZipPath)).toBe(false);
			expect(sendSpans).not.toHaveBeenCalled();
		});

		it("creates zip without screenshots when trace override keeps a test without a Playwright trace attachment", async () => {
			outputDir = createTestOutputDir("trace-override-no-attachment");

			const testId = "trace-override-no-attachment-123";
			const testLocation = {
				file: "/Users/test/project/test-e2e/simple.spec.ts",
				line: 5,
			};
			const playwrightOpentelemetry = {
				...DEFAULT_PLAYWRIGHT_OPENTELEMETRY_CONFIG,
				storeTraceZip: true,
				trace: "on" as const,
			};
			const reporter = new PlaywrightOpentelemetryReporter();
			const config = buildConfig({ rootDir: DEFAULT_ROOT_DIR });
			const testCase = buildTestCase(
				{
					id: testId,
					title: "test with otel trace override",
					titlePath: [
						"",
						"chromium",
						"simple.spec.ts",
						"test with otel trace override",
					],
					location: testLocation,
				},
				outputDir,
				playwrightOpentelemetry,
			);
			const testResult = buildTestResult(
				{
					status: "passed",
					duration: 1000,
					steps: [],
					attachments: [],
				},
				DEFAULT_START_TIME,
			);
			const mockSuite = {
				allTests: () => [testCase],
			} as Suite;

			reporter.onBegin(config, mockSuite);
			reporter.onTestBegin(testCase, testResult);
			reporter.onTestEnd(testCase, testResult);
			await reporter.onEnd({} as FullResult);

			const expectedZipName = `simple.spec.ts:5-${testId}-pw-otel.zip`;
			const expectedZipPath = path.join(outputDir, expectedZipName);
			expect(existsSync(expectedZipPath)).toBe(true);
			expect(sendSpans).toHaveBeenCalledTimes(1);

			const zipEntries = await readZipEntries(expectedZipPath);
			expect(zipEntries.has("traces/playwright-opentelemetry.json")).toBe(true);
			expect(JSON.parse(zipEntries.get("manifest.json") as string)).toEqual({
				version: 3,
				screenshots: [],
			});
		});

		it("includes fixture browser spans as a separate trace fragment", async () => {
			outputDir = createTestOutputDir("fixture-browser-spans");

			const testId = "fixture-browser-spans-123";
			const traceId = "1234567890abcdef1234567890abcdef";
			const rootSpanId = "1111111111111111";
			const browserPageSpanId = "2222222222222222";
			const testLocation = {
				file: "/Users/test/project/test-e2e/browser.spec.ts",
				line: 12,
			};
			const playwrightOpentelemetry = {
				...DEFAULT_PLAYWRIGHT_OPENTELEMETRY_CONFIG,
				storeTraceZip: true,
			};
			const reporter = new PlaywrightOpentelemetryReporter();
			const config = buildConfig({ rootDir: DEFAULT_ROOT_DIR });
			const testCase = buildTestCase(
				{
					id: testId,
					title: "captures browser spans",
					titlePath: [
						"",
						"chromium",
						"browser.spec.ts",
						"captures browser spans",
					],
					location: testLocation,
				},
				outputDir,
				playwrightOpentelemetry,
			);
			const testResult = buildTestResult(
				{
					status: "passed",
					duration: 1000,
					steps: [],
					attachments: [
						{
							name: "trace",
							contentType: "application/zip",
							path: "/tmp/playwright-trace.zip",
						},
						{
							name: TRACE_CONTEXT_ATTACHMENT_NAME,
							contentType: "application/json",
							body: Buffer.from(JSON.stringify({ traceId, rootSpanId })),
						},
						{
							name: FIXTURE_SPANS_ATTACHMENT_NAME,
							contentType: "application/json",
							body: Buffer.from(
								JSON.stringify({
									spans: [
										{
											traceId,
											spanId: browserPageSpanId,
											parentSpanId: rootSpanId,
											name: "browser.page",
											startTime: DEFAULT_START_TIME.toISOString(),
											endTime: new Date(
												DEFAULT_START_TIME.getTime() + 500,
											).toISOString(),
											attributes: {
												"browser.resource.type": "page",
												"browser.page.navigation.type": "document",
												"url.path": "/browser-spans",
											},
											events: [],
											status: { code: 0 },
											serviceName: "playwright-browser",
										},
									],
								}),
							),
						},
					],
				},
				DEFAULT_START_TIME,
			);
			const mockSuite = {
				allTests: () => [testCase],
			} as Suite;

			reporter.onBegin(config, mockSuite);
			reporter.onTestBegin(testCase, testResult);
			reporter.onTestEnd(testCase, testResult);
			await reporter.onEnd({} as FullResult);

			const expectedZipName = `browser.spec.ts:12-${testId}-pw-otel.zip`;
			const expectedZipPath = path.join(outputDir, expectedZipName);
			expect(existsSync(expectedZipPath)).toBe(true);

			const zipEntries = await readZipEntries(expectedZipPath);
			expect(zipEntries.has("traces/playwright-opentelemetry.json")).toBe(true);
			const browserTraceContent = zipEntries.get(
				"traces/playwright-fixture-spans.json",
			) as string;
			expect(browserTraceContent).toBeDefined();

			const browserTraceData = JSON.parse(browserTraceContent);
			const browserResourceSpan = browserTraceData.resourceSpans.find(
				(resourceSpan: {
					resource: {
						attributes: Array<{
							key: string;
							value: { stringValue?: string };
						}>;
					};
				}) =>
					resourceSpan.resource.attributes.some(
						(attribute) =>
							attribute.key === "service.name" &&
							attribute.value.stringValue === "playwright-browser",
					),
			);
			expect(browserResourceSpan).toBeDefined();
			expect(browserResourceSpan.scopeSpans[0].spans).toEqual([
				expect.objectContaining({
					traceId,
					spanId: browserPageSpanId,
					parentSpanId: rootSpanId,
					name: "browser.page",
				}),
			]);
		});

		it("stores describes array on the root test span", async () => {
			outputDir = createTestOutputDir("test-with-describes");

			const testId = "describe-test-123";
			const testLocation = {
				file: "/Users/test/project/test-e2e/homepage/login.spec.ts",
				line: 9,
			};

			const playwrightOpentelemetry = {
				...DEFAULT_PLAYWRIGHT_OPENTELEMETRY_CONFIG,
				storeTraceZip: true,
			};
			const reporter = new PlaywrightOpentelemetryReporter();

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
				playwrightOpentelemetry,
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
			reporter.onTestEnd(testCase, testResult);
			await reporter.onEnd({} as FullResult);

			// Find and read the zip file
			const expectedZipName = `login.spec.ts:9-${testId}-pw-otel.zip`;
			const expectedZipPath = path.join(outputDir, expectedZipName);
			expect(existsSync(expectedZipPath)).toBe(true);

			const zipEntries = await readZipEntries(expectedZipPath);

			const traceContent = zipEntries.get(
				"traces/playwright-opentelemetry.json",
			) as string;
			const traceData = JSON.parse(traceContent);
			const testSpan = traceData.resourceSpans[0].scopeSpans[0].spans.find(
				(s: { name: string }) => s.name === "playwright.test",
			);
			expect(testSpan.attributes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ key: "test.case.title" }),
					expect.objectContaining({ key: "playwright.test.describes" }),
					expect.objectContaining({ key: "code.file.path" }),
					expect.objectContaining({ key: "code.line.number" }),
				]),
			);
		});

		it("stores failed status on the root test span", async () => {
			outputDir = createTestOutputDir("test-failed");

			const testId = "failed-test-123";
			const testLocation = {
				file: "/Users/test/project/test-e2e/failing.spec.ts",
				line: 15,
			};

			const playwrightOpentelemetry = {
				...DEFAULT_PLAYWRIGHT_OPENTELEMETRY_CONFIG,
				storeTraceZip: true,
			};
			const reporter = new PlaywrightOpentelemetryReporter();

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
				playwrightOpentelemetry,
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
			reporter.onTestEnd(testCase, testResult);
			await reporter.onEnd({} as FullResult);

			// Find and read the zip file
			const expectedZipName = `failing.spec.ts:15-${testId}-pw-otel.zip`;
			const expectedZipPath = path.join(outputDir, expectedZipName);
			expect(existsSync(expectedZipPath)).toBe(true);

			const zipEntries = await readZipEntries(expectedZipPath);

			const traceContent = zipEntries.get(
				"traces/playwright-opentelemetry.json",
			) as string;
			const traceData = JSON.parse(traceContent);
			const testSpan = traceData.resourceSpans[0].scopeSpans[0].spans.find(
				(s: { name: string }) => s.name === "playwright.test",
			);
			expect(testSpan.attributes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						key: "playwright.test.status",
						value: { stringValue: "failed" },
					}),
				]),
			);
		});
	});

	describe("multiple test cases", () => {
		it("creates separate zip files for each test with screenshots from their respective traces", async () => {
			outputDir = createTestOutputDir("multiple-tests");

			// Define two tests with different pages
			const test1 = {
				id: "test-id-001",
				pageId: "page-first",
				title: "first test",
				location: {
					file: "/Users/test/project/test-e2e/multi.spec.ts",
					line: 5,
				},
			};

			const test2 = {
				id: "test-id-002",
				pageId: "page-second",
				title: "second test",
				location: {
					file: "/Users/test/project/test-e2e/multi.spec.ts",
					line: 20,
				},
			};

			// Create screenshots attachments for each test
			const test1TraceDir = path.join(outputDir, "trace1");
			const test2TraceDir = path.join(outputDir, "trace2");
			mkdirSync(test1TraceDir, { recursive: true });
			mkdirSync(test2TraceDir, { recursive: true });

			const screenshot1Timestamp = DEFAULT_START_TIME.getTime() + 500;
			const attachments1 = await createScreenshotsAttachments(test1TraceDir, [
				{ pageId: test1.pageId, timestamp: screenshot1Timestamp },
			]);

			const screenshot2Timestamp1 = DEFAULT_START_TIME.getTime() + 2500;
			const screenshot2Timestamp2 = DEFAULT_START_TIME.getTime() + 2700;
			const screenshot2Timestamp3 = DEFAULT_START_TIME.getTime() + 3000;
			const attachments2 = await createScreenshotsAttachments(test2TraceDir, [
				{ pageId: test2.pageId, timestamp: screenshot2Timestamp1 },
				{ pageId: test2.pageId, timestamp: screenshot2Timestamp2 },
				{ pageId: test2.pageId, timestamp: screenshot2Timestamp3 },
			]);

			const playwrightOpentelemetry = {
				...DEFAULT_PLAYWRIGHT_OPENTELEMETRY_CONFIG,
				storeTraceZip: true,
			};
			const reporter = new PlaywrightOpentelemetryReporter();

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
				playwrightOpentelemetry,
			);

			const testCase2 = buildTestCase(
				{
					id: test2.id,
					title: test2.title,
					titlePath: ["", "chromium", "multi.spec.ts", test2.title],
					location: test2.location,
				},
				outputDir,
				playwrightOpentelemetry,
			);

			const testResult1 = buildTestResult(
				{
					status: "passed",
					duration: 1500,
					steps: [{ title: "step 1", duration: 100 }],
					attachments: attachments1,
				},
				DEFAULT_START_TIME,
			);

			const testResult2 = buildTestResult(
				{
					status: "passed",
					duration: 1800,
					steps: [{ title: "step 2", duration: 150 }],
					attachments: attachments2,
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

			reporter.onTestEnd(testCase1, testResult1);

			// --- Test 2 execution ---
			reporter.onTestBegin(testCase2, testResult2);

			for (const step of testResult2.steps) {
				reporter.onStepBegin(testCase2, testResult2, step);
				reporter.onStepEnd(testCase2, testResult2, step);
			}

			reporter.onTestEnd(testCase2, testResult2);

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
				"traces/playwright-opentelemetry.json",
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
				new RegExp(`screenshots/${test1.pageId}-\\d+\\.jpeg$`),
			);
			// Ensure no screenshots from test 2 leaked into test 1's zip
			expect(screenshots1.some((f) => f.includes(test2.pageId))).toBe(false);

			// --- Verify Test 2 zip file ---
			const expectedZip2Name = `multi.spec.ts:20-${test2.id}-pw-otel.zip`;
			const expectedZip2Path = path.join(outputDir, expectedZip2Name);

			expect(existsSync(expectedZip2Path)).toBe(true);

			const zip2Entries = await readZipEntries(expectedZip2Path);

			// Verify trace file for test 2
			const trace2Content = zip2Entries.get(
				"traces/playwright-opentelemetry.json",
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
				expect(filename).toMatch(new RegExp(`^${test2.pageId}-\\d+\\.jpeg$`));
			}
			// Ensure no screenshots from test 1 leaked into test 2's zip
			expect(screenshots2.some((f) => f.includes(test1.pageId))).toBe(false);
		});

		it("handles tests with multiple pages correctly - all screenshots in same trace", async () => {
			outputDir = createTestOutputDir("multi-page-test");

			const testId = "test-multi-page";
			// Two different pages in the same test
			const page1Id = "page-main";
			const page2Id = "page-popup";
			const testLocation = {
				file: "/Users/test/project/test-e2e/popup.spec.ts",
				line: 15,
			};

			// Screenshots from both pages
			const mainPageScreenshot = DEFAULT_START_TIME.getTime() + 600;
			const popupScreenshot1 = DEFAULT_START_TIME.getTime() + 1200;
			const popupScreenshot2 = DEFAULT_START_TIME.getTime() + 1500;

			const attachments = await createScreenshotsAttachments(outputDir, [
				{ pageId: page1Id, timestamp: mainPageScreenshot },
				{ pageId: page2Id, timestamp: popupScreenshot1 },
				{ pageId: page2Id, timestamp: popupScreenshot2 },
			]);

			const playwrightOpentelemetry = {
				...DEFAULT_PLAYWRIGHT_OPENTELEMETRY_CONFIG,
				storeTraceZip: true,
			};
			const reporter = new PlaywrightOpentelemetryReporter();

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
				playwrightOpentelemetry,
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
					attachments,
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

			reporter.onTestEnd(testCase, testResult);
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
			const page1Screenshots = screenshots.filter((f) => f.includes(page1Id));
			const page2Screenshots = screenshots.filter((f) => f.includes(page2Id));

			expect(page1Screenshots).toHaveLength(1);
			expect(page2Screenshots).toHaveLength(2);
		});
	});
});
