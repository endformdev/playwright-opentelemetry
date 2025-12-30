import {
	createResource,
	type JSX,
	Match,
	onCleanup,
	type Resource,
	Switch,
} from "solid-js";
import type { TraceSource } from "../trace-source";
import { loadRemoteApi } from "./traceInfoDataLoaders/apiLoader";
import {
	loadLocalZip,
	loadRemoteZip,
	unloadCurrentTrace,
} from "./traceInfoDataLoaders/zipLoader";

export interface TraceInfo {
	testInfo: TestInfo;
	traceDataUrls: string[];
	screenshots: ScreenshotInfo[];
}

export interface TestInfo {
	name: string;
	describes: string[];
	file: string;
	line: number;
	status: TestStatus;
	/** OpenTelemetry trace ID for this test */
	traceId: string;
	startTimeUnixNano: string;
	endTimeUnixNano: string;
}

export type TestStatus =
	| "passed"
	| "failed"
	| "skipped"
	| "timedOut"
	| "interrupted";

export interface ScreenshotInfo {
	timestamp: number;
	url: string;
}

export interface TraceInfoLoaderProps {
	source: TraceSource;
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
