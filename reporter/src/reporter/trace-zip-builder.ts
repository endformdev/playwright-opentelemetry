import fs from "node:fs/promises";
import path from "node:path";
import type { TestCase, TestStatus } from "@playwright/test/reporter";
import type { Entry, FileEntry } from "@zip.js/zip.js";
import {
	BlobReader,
	BlobWriter,
	TextReader,
	ZipReader,
	ZipWriter,
} from "@zip.js/zip.js";
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

const PLAYWRIGHT_TRACE_RESOURCES_DIR = "resources/";

/**
 * Extract screenshots from a Playwright trace ZIP file.
 * Screenshots are stored in the resources/ directory with names like:
 * {pageGuid}-{timestamp}.jpeg (e.g., page@abc123-1766929201038.jpeg)
 *
 * @param traceZipPath - Path to the Playwright trace.zip file
 * @returns Map of filename (without resources/ prefix) to Blob
 */
export async function extractScreenshotsFromPlaywrightTrace(
	traceZipPath: string,
): Promise<Map<string, Blob>> {
	const screenshots = new Map<string, Blob>();

	try {
		// Read the trace ZIP file
		const zipBuffer = await fs.readFile(traceZipPath);
		const zipBlob = new Blob([zipBuffer]);

		// Open the ZIP and get entries
		const zipReader = new ZipReader(new BlobReader(zipBlob));
		const entries = await zipReader.getEntries();

		// Extract screenshot files from resources/ directory
		// Process concurrently for efficiency
		await Promise.all(
			entries
				.filter((entry): entry is FileEntry => {
					if (!isFileEntry(entry)) return false;
					if (!entry.filename.startsWith(PLAYWRIGHT_TRACE_RESOURCES_DIR))
						return false;
					const name = entry.filename.slice(
						PLAYWRIGHT_TRACE_RESOURCES_DIR.length,
					);
					return name.endsWith(".jpeg") || name.endsWith(".jpg");
				})
				.map(async (entry) => {
					const filename = entry.filename.slice(
						PLAYWRIGHT_TRACE_RESOURCES_DIR.length,
					);
					const blob = await entry.getData(new BlobWriter("image/jpeg"));
					screenshots.set(filename, blob);
				}),
		);

		await zipReader.close();
	} catch (err) {
		// If file doesn't exist or can't be read, return empty map
		// This allows tests without tracing enabled to still work
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			console.warn(
				`Warning: Could not extract screenshots from trace ZIP: ${err}`,
			);
		}
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
	/** Screenshots extracted from Playwright trace ZIP (filename -> Blob) */
	screenshots: Map<string, Blob>;
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
	const {
		outputDir,
		test,
		spans,
		serviceName,
		playwrightVersion,
		screenshots,
	} = options;

	// Build OTLP request JSON
	const otlpRequest = buildOtlpRequest(spans, serviceName, playwrightVersion);
	const traceJson = JSON.stringify(otlpRequest, null, 2);

	// Get traceId from the test span (first span should be the test span)
	const testSpan = spans.find((s) => s.name === "playwright.test");
	const traceId = testSpan?.traceId ?? "";

	// Build test.json content
	const testInfo = buildTestInfo(options, traceId);
	const testInfoJson = JSON.stringify(testInfo, null, 2);

	// Create zip file
	const blobWriter = new BlobWriter("application/zip");
	const zipWriter = new ZipWriter(blobWriter);

	// Add test.json and trace JSON first
	await zipWriter.add("test.json", new TextReader(testInfoJson));
	await zipWriter.add(
		"opentelemetry-protocol/playwright-opentelemetry.json",
		new TextReader(traceJson),
	);

	// Add screenshots concurrently by streaming directly from input blobs
	await Promise.all(
		Array.from(screenshots.entries()).map(([filename, blob]) =>
			zipWriter.add(`screenshots/${filename}`, blob.stream()),
		),
	);

	// Close and get the zip blob
	const zipBlob = await zipWriter.close();

	// Write to file
	const zipFilename = getZipFilename(test, test.id);
	const zipPath = path.join(outputDir, zipFilename);

	const arrayBuffer = await zipBlob.arrayBuffer();
	await fs.writeFile(zipPath, Buffer.from(arrayBuffer));
}

function isFileEntry(entry: Entry): entry is FileEntry {
	return !entry.directory;
}
