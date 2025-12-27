/**
 * Data loader types for loading trace data from various sources.
 */

import type { OtlpTraceExport } from "../../types/otel";

/**
 * Result of loading trace data from a source
 */
export interface LoadedTraceData {
	/** The OTLP trace JSON parsed from the source */
	traceData: OtlpTraceExport;
	/** List of screenshot filenames available */
	screenshots: string[];
	/** Base URL for fetching screenshots */
	screenshotBaseUrl: string;
}

/**
 * Progress callback for tracking load progress
 */
export type LoadProgress = (done: number, total: number) => void;

/**
 * Backend interface for loading trace data.
 * Implementations handle different sources (ZIP, URL, etc.)
 */
export interface TraceLoaderBackend {
	/**
	 * Check if the backend is for a live/streaming trace
	 */
	isLive(): boolean;

	/**
	 * Get list of all entry names in the trace
	 */
	entryNames(): Promise<string[]>;

	/**
	 * Check if an entry exists
	 */
	hasEntry(entryName: string): Promise<boolean>;

	/**
	 * Read an entry as text
	 */
	readText(entryName: string): Promise<string | undefined>;

	/**
	 * Read an entry as a Blob
	 */
	readBlob(entryName: string): Promise<Blob | undefined>;
}

/**
 * Known file paths in the trace ZIP
 */
export const TRACE_FILE_PATHS = {
	/** Main OTLP trace JSON file */
	TRACE_JSON: "oltp-traces/pw-reporter-trace.json",
	/** Screenshots directory prefix */
	SCREENSHOTS_DIR: "screenshots/",
} as const;
