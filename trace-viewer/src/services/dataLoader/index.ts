/**
 * Unified trace data loader that handles different source types.
 * This module is designed to be testable independently of the UI.
 */

import type { OtlpTraceExport } from "../../types/otel";
import type { ParsedTrace } from "../../types/trace";
import { createScreenshots, parseOtlpTrace } from "../traceParser";
import { loadZipFile } from "./zipLoader";
import type { LoadProgress } from "./types";
import { TRACE_FILE_PATHS } from "./types";

/**
 * The different types of trace sources we support
 */
export type TraceSource =
	| { kind: "local-zip"; blob: Blob }
	| { kind: "remote-zip"; url: string }
	| { kind: "remote-api"; baseUrl: string };

/**
 * Result of loading a trace - contains parsed data and screenshot access
 */
export interface LoadedTrace {
	/** The parsed trace data */
	parsedTrace: ParsedTrace;
	/** The raw OTLP JSON for inspection */
	rawOtlpJson: OtlpTraceExport;
	/** Map of screenshot filename -> blob (for local sources) */
	screenshotBlobs: Map<string, Blob>;
}

/**
 * Parse a traceSource query parameter into a TraceSource object.
 * Returns null if the source is empty/undefined.
 *
 * The traceSource can be:
 * - A URL ending in .zip -> remote-zip
 * - Any other URL -> remote-api (treated as base URL)
 */
export function parseTraceSourceParam(
	source: string | null,
): TraceSource | null {
	if (!source) return null;

	// Check if it's a ZIP URL
	if (source.endsWith(".zip")) {
		return { kind: "remote-zip", url: source };
	}

	// Otherwise treat as remote API base URL
	return { kind: "remote-api", baseUrl: source };
}

/**
 * Load trace data from a source.
 * This is the main entry point for loading traces.
 */
export async function loadTrace(
	source: TraceSource,
	onProgress?: LoadProgress,
): Promise<LoadedTrace> {
	switch (source.kind) {
		case "local-zip":
			return loadFromLocalZip(source.blob, onProgress);
		case "remote-zip":
			return loadFromRemoteZip(source.url, onProgress);
		case "remote-api":
			return loadFromRemoteApi(source.baseUrl, onProgress);
	}
}

/**
 * Load trace from a local ZIP blob (from file drop)
 */
async function loadFromLocalZip(
	blob: Blob,
	onProgress?: LoadProgress,
): Promise<LoadedTrace> {
	const zipResult = await loadZipFile(blob, onProgress);

	// Create screenshots with blob URLs
	const screenshotBlobs = zipResult.screenshots;
	const screenshotBaseUrl = "blob:local";

	// For local zips, we need to track blobs for service worker
	const screenshots = createScreenshots(
		zipResult.screenshotFilenames,
		screenshotBaseUrl,
	);

	const parsedTrace = parseOtlpTrace(zipResult.traceData, screenshots);

	return {
		parsedTrace,
		rawOtlpJson: zipResult.traceData,
		screenshotBlobs,
	};
}

/**
 * Load trace from a remote ZIP URL
 */
async function loadFromRemoteZip(
	url: string,
	onProgress?: LoadProgress,
): Promise<LoadedTrace> {
	// Fetch the ZIP file
	onProgress?.(0, 100);

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch ZIP from ${url}: ${response.statusText}`);
	}

	const blob = await response.blob();
	onProgress?.(50, 100);

	// Use the same logic as local ZIP
	return loadFromLocalZip(blob, (done, total) => {
		// Scale progress to 50-100 range
		onProgress?.(50 + (done / total) * 50, 100);
	});
}

/**
 * Load trace from a remote trace API
 * The API follows the pattern:
 * - GET {baseUrl}/oltp-traces/pw-reporter-trace.json - Trace data
 * - GET {baseUrl}/screenshots - List of screenshots
 * - GET {baseUrl}/screenshots/{filename} - Individual screenshots
 */
async function loadFromRemoteApi(
	baseUrl: string,
	onProgress?: LoadProgress,
): Promise<LoadedTrace> {
	onProgress?.(0, 100);

	// Normalize base URL (remove trailing slash)
	const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

	// Fetch trace JSON
	const traceUrl = `${normalizedBaseUrl}/${TRACE_FILE_PATHS.TRACE_JSON}`;
	const traceResponse = await fetch(traceUrl);
	if (!traceResponse.ok) {
		throw new Error(
			`Failed to fetch trace from ${traceUrl}: ${traceResponse.statusText}`,
		);
	}

	const rawOtlpJson: OtlpTraceExport = await traceResponse.json();
	onProgress?.(50, 100);

	// Fetch screenshot list
	const screenshotsListUrl = `${normalizedBaseUrl}/screenshots`;
	let screenshotFilenames: string[] = [];

	try {
		const screenshotsResponse = await fetch(screenshotsListUrl);
		if (screenshotsResponse.ok) {
			screenshotFilenames = await screenshotsResponse.json();
		}
	} catch {
		// Screenshots are optional, continue without them
		console.warn("Could not fetch screenshot list");
	}

	onProgress?.(75, 100);

	// Create screenshots with remote URLs
	const screenshotBaseUrl = `${normalizedBaseUrl}/screenshots`;
	const screenshots = createScreenshots(screenshotFilenames, screenshotBaseUrl);

	const parsedTrace = parseOtlpTrace(rawOtlpJson, screenshots);

	onProgress?.(100, 100);

	return {
		parsedTrace,
		rawOtlpJson,
		screenshotBlobs: new Map(), // No local blobs for remote API
	};
}

/**
 * Create a TraceSource for a dropped file
 */
export function createLocalZipSource(blob: Blob): TraceSource {
	return { kind: "local-zip", blob };
}
