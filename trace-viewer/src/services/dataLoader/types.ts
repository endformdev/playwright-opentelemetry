import type { OtlpTraceExport } from "../../types/otel";

export interface LoadedTraceData {
	/** The OTLP trace JSON parsed from the source */
	traceData: OtlpTraceExport;
	/** List of screenshot filenames available */
	screenshots: string[];
	/** Base URL for fetching screenshots */
	screenshotBaseUrl: string;
}

export type LoadProgress = (done: number, total: number) => void;

export interface TraceLoaderBackend {
	entryNames(): Promise<string[]>;
	hasEntry(entryName: string): Promise<boolean>;

	readText(entryName: string): Promise<string | undefined>;
	readBlob(entryName: string): Promise<Blob | undefined>;
}

export const TRACE_FILE_PATHS = {
	/** Main OTLP trace JSON file */
	TRACE_JSON: "oltp-traces/pw-reporter-trace.json",
	/** Screenshots directory prefix */
	SCREENSHOTS_DIR: "screenshots/",
} as const;
