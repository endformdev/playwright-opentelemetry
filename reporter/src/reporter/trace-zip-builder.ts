import fs from "node:fs/promises";
import path from "node:path";
import type { TestCase } from "@playwright/test/reporter";
import { BlobWriter, ZipWriter } from "@zip.js/zip.js";
import type { Span } from "../shared/otel";
import {
	addScreenshotsToZip,
	type ScreenshotResource,
} from "../shared/screenshots-zip";
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

export interface CreateTraceZipOptions {
	outputDir: string;
	test: TestCase;
	spans: Span[];
	fixtureSpans: Span[];
	playwrightVersion: string;
	/** Screenshots the fixture captured for this test */
	screenshots: ScreenshotResource[];
}

export type CreateTraceZipBlobOptions = Omit<
	CreateTraceZipOptions,
	"outputDir"
>;

/**
 * Create a zip file containing the OTLP trace JSON and screenshots for a test.
 */
export async function createTraceZip(
	options: CreateTraceZipOptions,
): Promise<void> {
	const zipBlob = await createTraceZipBlob(options);
	await writeTraceZip(options.outputDir, options.test, zipBlob);
}

export async function createTraceZipBlob(
	options: CreateTraceZipBlobOptions,
): Promise<Blob> {
	const { spans, fixtureSpans, playwrightVersion, screenshots } = options;

	// Build OTLP request JSON
	const otlpRequest = buildOtlpRequest(spans, playwrightVersion);
	const traceJson = JSON.stringify(otlpRequest, null, 2);

	// Create zip file
	const blobWriter = new BlobWriter("application/zip");
	const zipWriter = new ZipWriter(blobWriter);

	// Add trace JSON first
	await zipWriter.add(
		"traces/playwright-opentelemetry.json",
		new Blob([traceJson]).stream(),
	);

	if (fixtureSpans.length > 0) {
		const fixtureOtlpRequest = buildOtlpRequest(
			fixtureSpans,
			playwrightVersion,
		);
		await zipWriter.add(
			"traces/playwright-fixture-spans.json",
			new Blob([JSON.stringify(fixtureOtlpRequest, null, 2)]).stream(),
		);
	}

	await addScreenshotsToZip(zipWriter, screenshots);

	return zipWriter.close();
}

export async function writeTraceZip(
	outputDir: string,
	test: TestCase,
	zipBlob: Blob,
): Promise<void> {
	const zipFilename = getZipFilename(test, test.id);
	const zipPath = path.join(outputDir, zipFilename);

	const arrayBuffer = await zipBlob.arrayBuffer();
	await fs.writeFile(zipPath, Buffer.from(arrayBuffer));
}
