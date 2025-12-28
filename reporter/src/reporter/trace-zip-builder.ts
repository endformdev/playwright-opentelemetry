import fs from "node:fs/promises";
import path from "node:path";
import type { TestCase, TestStatus } from "@playwright/test/reporter";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { getScreenshotsDir } from "../shared/trace-files";
import type { Span } from "./reporter";
import { buildOtlpRequest } from "./sender";

/**
 * Test metadata stored in test.json at the root of the trace zip.
 */
export interface TestInfo {
	/** Test name (from test.title) */
	name: string;
	/** Describe blocks containing this test (from titlePath, excluding root/project/file/test) */
	describes: string[];
	/** Relative file path to the test file */
	file: string;
	/** Line number where the test is defined */
	line: number;
	/** Test result status */
	status: TestStatus;
	/** OpenTelemetry trace ID for this test */
	traceId: string;
	/** Start time in nanoseconds since Unix epoch (as string to preserve precision) */
	startTimeUnixNano: string;
	/** End time in nanoseconds since Unix epoch (as string to preserve precision) */
	endTimeUnixNano: string;
}

/**
 * Get the zip filename based on test location and ID.
 * Format: {basename(file)}:{line}-{testId}-pw-otel.zip
 * Fallback: {testId}-pw-otel.zip (if no location info)
 */
export function getZipFilename(test: TestCase, testId: string): string {
	if (test.location) {
		const basename = path.basename(test.location.file);
		return `${basename}:${test.location.line}-${testId}-pw-otel.zip`;
	}
	return `${testId}-pw-otel.zip`;
}

/**
 * Get all screenshots for a test from its dedicated screenshots directory.
 * Returns a Map of filename -> file buffer.
 */
async function getTestScreenshots(
	outputDir: string,
	testId: string,
): Promise<Map<string, Buffer>> {
	const screenshots = new Map<string, Buffer>();
	const screenshotsDir = getScreenshotsDir(outputDir, testId);

	try {
		const files = await fs.readdir(screenshotsDir);

		for (const file of files) {
			if (!file.endsWith(".jpeg") && !file.endsWith(".jpg")) {
				continue;
			}

			const filePath = path.join(screenshotsDir, file);
			const buffer = await fs.readFile(filePath);
			screenshots.set(file, buffer);
		}
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			throw err;
		}
		// Directory doesn't exist, no screenshots
	}

	return screenshots;
}

export interface CreateTraceZipOptions {
	outputDir: string;
	testId: string;
	test: TestCase;
	spans: Span[];
	serviceName: string;
	playwrightVersion: string;
	/** Relative file path to the test file (relative to rootDir) */
	relativeFilePath: string;
	/** Test result status */
	status: TestStatus;
	/** Test start time */
	startTime: Date;
	/** Test duration in milliseconds */
	duration: number;
}

/**
 * Build the TestInfo object for test.json.
 */
export function buildTestInfo(
	options: CreateTraceZipOptions,
	traceId: string,
): TestInfo {
	const { test, relativeFilePath, status, startTime, duration } = options;

	// titlePath format: ['', 'project', 'filename', ...describes, 'testname']
	// We want the describes (everything between filename and testname)
	const titlePath = test.titlePath();
	const describes = titlePath.length > 4 ? titlePath.slice(3, -1) : [];

	// Line number from location, fallback to 0 if not available
	const line = test.location?.line ?? 0;

	// Convert times to nanoseconds (as strings to preserve precision)
	const startTimeUnixNano = (startTime.getTime() * 1_000_000).toString();
	const endTimeUnixNano = (
		(startTime.getTime() + duration) *
		1_000_000
	).toString();

	return {
		name: test.title,
		describes,
		file: relativeFilePath,
		line,
		status,
		traceId,
		startTimeUnixNano,
		endTimeUnixNano,
	};
}

/**
 * Create a zip file containing the OTLP trace JSON, test.json, and screenshots for a test.
 */
export async function createTraceZip(
	options: CreateTraceZipOptions,
): Promise<void> {
	const { outputDir, testId, test, spans, serviceName, playwrightVersion } =
		options;

	// Build OTLP request JSON
	const otlpRequest = buildOtlpRequest(spans, serviceName, playwrightVersion);
	const traceJson = JSON.stringify(otlpRequest, null, 2);

	// Get traceId from the test span (first span should be the test span)
	const testSpan = spans.find((s) => s.name === "playwright.test");
	const traceId = testSpan?.traceId ?? "";

	// Build test.json content
	const testInfo = buildTestInfo(options, traceId);
	const testInfoJson = JSON.stringify(testInfo, null, 2);

	// Get screenshots for this test
	const screenshots = await getTestScreenshots(outputDir, testId);

	// Create zip file
	const blobWriter = new BlobWriter("application/zip");
	const zipWriter = new ZipWriter(blobWriter);

	// Add test.json at root
	await zipWriter.add("test.json", new TextReader(testInfoJson));

	// Add trace JSON
	await zipWriter.add(
		"opentelemetry-protocol/playwright-opentelemetry.json",
		new TextReader(traceJson),
	);

	// Add screenshots
	for (const [filename, buffer] of screenshots) {
		const blob = new Blob([buffer as Uint8Array<ArrayBuffer>]);
		await zipWriter.add(`screenshots/${filename}`, blob.stream());
	}

	// Close and get the zip blob
	const zipBlob = await zipWriter.close();

	// Write to file
	const zipFilename = getZipFilename(test, testId);
	const zipPath = path.join(outputDir, zipFilename);

	const arrayBuffer = await zipBlob.arrayBuffer();
	await fs.writeFile(zipPath, Buffer.from(arrayBuffer));
}
