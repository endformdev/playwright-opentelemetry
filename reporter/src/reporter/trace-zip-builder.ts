import fs from "node:fs/promises";
import path from "node:path";
import type { TestCase } from "@playwright/test/reporter";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { getScreenshotsDir } from "../shared/trace-files";
import type { Span } from "./reporter";
import { buildOtlpRequest } from "./sender";

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
}

/**
 * Create a zip file containing the OTLP trace JSON and screenshots for a test.
 */
export async function createTraceZip(
	options: CreateTraceZipOptions,
): Promise<void> {
	const { outputDir, testId, test, spans, serviceName, playwrightVersion } =
		options;

	// Build OTLP request JSON
	const otlpRequest = buildOtlpRequest(spans, serviceName, playwrightVersion);
	const traceJson = JSON.stringify(otlpRequest, null, 2);

	// Get screenshots for this test
	const screenshots = await getTestScreenshots(outputDir, testId);

	// Create zip file
	const blobWriter = new BlobWriter("application/zip");
	const zipWriter = new ZipWriter(blobWriter);

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
