import {
	createResource,
	type JSX,
	Match,
	onCleanup,
	type Resource,
	Switch,
} from "solid-js";
import type { TraceSource } from "../traceSource";
import { loadRemoteApi } from "./traceInfoDataLoaders/apiLoader";
import {
	loadLocalZip,
	loadRemoteZip,
	unloadCurrentTrace,
} from "./traceInfoDataLoaders/zipLoader";

/**
 * Test result status from the trace
 */
export type TestStatus =
	| "passed"
	| "failed"
	| "skipped"
	| "timedOut"
	| "interrupted";

/**
 * Base test information from test.json
 */
export interface TestInfo {
	/** Test name (from test.title) */
	name: string;
	/** Describe blocks containing this test */
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
 * Screenshot information with timestamp and URL
 */
export interface ScreenshotInfo {
	/** Unix timestamp in milliseconds when the screenshot was taken */
	timestamp: number;
	/** Complete URL to fetch the screenshot */
	url: string;
}

/**
 * Loaded trace data including test info, trace URLs, and screenshots
 */
export interface TraceInfo {
	/** Base test information from test.json */
	testInfo: TestInfo;
	/** Complete URLs to fetch OTLP trace JSON files */
	traceDataUrls: string[];
	/** Screenshots with timestamp and URL */
	screenshots: ScreenshotInfo[];
}

export interface TraceInfoLoaderProps {
	/** The trace source to load from */
	source: TraceSource;
	/** Render function for the loaded state */
	children: (traceInfo: TraceInfo) => JSX.Element;
}

export function TraceInfoLoader(props: TraceInfoLoaderProps): JSX.Element {
	const traceInfo = useTraceInfoLoader(() => props.source);

	return (
		<Switch>
			<Match when={traceInfo.loading}>
				<div class="flex flex-1 items-center justify-center">
					<div class="text-center">
						<div class="mb-2">Loading trace...</div>
						<div class="text-sm text-gray-500">
							{props.source.kind === "local-zip" && "Extracting ZIP file..."}
							{props.source.kind === "remote-zip" &&
								"Downloading and extracting ZIP..."}
							{props.source.kind === "remote-api" && "Fetching trace data..."}
						</div>
					</div>
				</div>
			</Match>
			<Match when={traceInfo.error}>
				<div class="flex flex-1 items-center justify-center">
					<div class="text-center text-red-600">
						<div class="mb-2 font-semibold">Failed to load trace</div>
						<div class="text-sm">{String(traceInfo.error)}</div>
					</div>
				</div>
			</Match>
			<Match when={traceInfo()}>{(info) => props.children(info())}</Match>
		</Switch>
	);
}

export function useTraceInfoLoader(
	source: () => TraceSource | null,
): Resource<TraceInfo | undefined> {
	const [traceInfo] = createResource(source, async (src) => {
		if (!src) return undefined;
		return loadTraceSource(src);
	});

	// Cleanup: unload trace from service worker when component unmounts
	onCleanup(() => {
		unloadCurrentTrace();
	});

	return traceInfo;
}

async function loadTraceSource(source: TraceSource): Promise<TraceInfo> {
	switch (source.kind) {
		case "local-zip":
			return loadLocalZip(source.file);
		case "remote-zip":
			return loadRemoteZip(source.url);
		case "remote-api":
			return loadRemoteApi(source.url);
	}
}
