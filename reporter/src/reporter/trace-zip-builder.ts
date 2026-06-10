import fs from "node:fs/promises";
import path from "node:path";
import type { TestCase } from "@playwright/test/reporter";
import type { eventWithTime } from "@rrweb/types";
import { BlobWriter, ZipWriter } from "@zip.js/zip.js";
import type { Span } from "../shared/otel";
import { buildOtlpRequest } from "./sender";

export interface RrwebRecordingsArtifact {
	version: 1;
	recordings: RrwebRecordingArtifact[];
	warnings?: string[];
}

export interface RrwebRecordingArtifact {
	id: string;
	pageId: string;
	documentId?: string;
	initialUrl?: string;
	events: eventWithTime[];
	warnings?: string[];
}

export interface RrwebTraceManifest {
	version: 1;
	recordings: RrwebRecordingManifest[];
	recordingOptions: {
		recordCanvas: true;
		recordCrossOriginIframes: true;
		collectFonts: true;
		inlineImages: true;
		checkoutEveryNms: 5000;
	};
	warnings?: string[];
}

export interface RrwebRecordingManifest {
	id: string;
	pageId: string;
	startTime: number;
	endTime: number;
	eventCount: number;
	initialUrl?: string;
	segments: RrwebSegmentManifest[];
	warnings?: string[];
}

export interface RrwebSegmentManifest {
	file: string;
	startTime: number;
	endTime: number;
	eventCount: number;
	hasFullSnapshot: boolean;
}

export interface CreateTraceZipOptions {
	outputDir: string;
	test: TestCase;
	spans: Span[];
	fixtureSpans: Span[];
	serviceName: string;
	playwrightVersion: string;
	rrweb: RrwebRecordingsArtifact | null;
}

export type CreateTraceZipBlobOptions = Omit<
	CreateTraceZipOptions,
	"outputDir"
>;

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

export async function createTraceZip(
	options: CreateTraceZipOptions,
): Promise<void> {
	const zipBlob = await createTraceZipBlob(options);
	await writeTraceZip(options.outputDir, options.test, zipBlob);
}

export async function createTraceZipBlob(
	options: CreateTraceZipBlobOptions,
): Promise<Blob> {
	const { spans, fixtureSpans, serviceName, playwrightVersion, rrweb } =
		options;

	const otlpRequest = buildOtlpRequest(spans, serviceName, playwrightVersion);
	const traceJson = JSON.stringify(otlpRequest, null, 2);

	const blobWriter = new BlobWriter("application/zip");
	const zipWriter = new ZipWriter(blobWriter);

	await zipWriter.add(
		"traces/playwright-opentelemetry.json",
		new Blob([traceJson]).stream(),
	);

	if (fixtureSpans.length > 0) {
		const fixtureOtlpRequest = buildOtlpRequest(
			fixtureSpans,
			"playwright-browser",
			playwrightVersion,
		);
		await zipWriter.add(
			"traces/playwright-browser.json",
			new Blob([JSON.stringify(fixtureOtlpRequest, null, 2)]).stream(),
		);
	}

	if (rrweb) {
		await addRrwebToZip(zipWriter, rrweb);
	}

	return zipWriter.close();
}

export async function createRrwebZip(
	rrweb: RrwebRecordingsArtifact,
): Promise<Blob> {
	const blobWriter = new BlobWriter("application/zip");
	const zipWriter = new ZipWriter(blobWriter);
	await addRrwebToZip(zipWriter, rrweb);
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

async function addRrwebToZip(
	zipWriter: ZipWriter<Blob>,
	rrweb: RrwebRecordingsArtifact,
): Promise<void> {
	const recordings = rrweb.recordings
		.map((recording) => ({
			...recording,
			events: [...recording.events].sort((a, b) => a.timestamp - b.timestamp),
		}))
		.filter((recording) => recording.events.length > 0);
	const manifest = createRrwebManifest({ ...rrweb, recordings });

	await zipWriter.add(
		"rrweb/manifest.json",
		new Blob([JSON.stringify(manifest, null, 2)], {
			type: "application/json",
		}).stream(),
	);

	for (const recording of recordings) {
		await zipWriter.add(
			`rrweb/recordings/${recording.id}/00000.json`,
			new Blob([JSON.stringify(recording.events)], {
				type: "application/json",
			}).stream(),
		);
	}
}

function createRrwebManifest(
	rrweb: RrwebRecordingsArtifact,
): RrwebTraceManifest {
	return {
		version: 1,
		recordings: rrweb.recordings.map((recording) => {
			const startTime = recording.events[0]?.timestamp ?? 0;
			const endTime = recording.events.at(-1)?.timestamp ?? startTime;
			const file = `rrweb/recordings/${recording.id}/00000.json`;
			return {
				id: recording.id,
				pageId: recording.pageId,
				startTime,
				endTime,
				eventCount: recording.events.length,
				initialUrl: recording.initialUrl,
				segments: [
					{
						file,
						startTime,
						endTime,
						eventCount: recording.events.length,
						hasFullSnapshot: recording.events.some((event) => event.type === 2),
					},
				],
				warnings: recording.warnings,
			};
		}),
		recordingOptions: {
			recordCanvas: true,
			recordCrossOriginIframes: true,
			collectFonts: true,
			inlineImages: true,
			checkoutEveryNms: 5000,
		},
		warnings: rrweb.warnings,
	};
}
