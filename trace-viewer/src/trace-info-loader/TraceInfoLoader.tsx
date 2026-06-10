import {
	createResource,
	type Accessor,
	type JSX,
	Match,
	onCleanup,
	type Resource,
	Switch,
} from "solid-js";
import { NoTraceLoaded } from "../NoTraceLoaded";
import type { TraceSource } from "../trace-source";
import type { TraceSourceSetter } from "../trace-source";
import type { OtlpExport } from "../trace-data-loader";
import { loadRemoteApi } from "./traceInfoDataLoaders/apiLoader";
import {
	loadLocalZip,
	loadRemoteZip,
	unloadCurrentTrace,
} from "./traceInfoDataLoaders/zipLoader";

export interface TraceInfo {
	testInfo: TestInfo;
	traceData: OtlpExport;
	screenshots: Resource<ScreenshotInfo[]>;
}

export interface TraceInfoData {
	testInfo: TestInfo;
	traceData: OtlpExport;
	loadScreenshots: () => Promise<ScreenshotInfo[]>;
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
	setTraceSource: TraceSourceSetter;
	children: (traceInfo: TraceInfo) => JSX.Element;
}

export function TraceInfoLoader(props: TraceInfoLoaderProps): JSX.Element {
	const traceInfoData = useTraceInfoLoader(() => props.source);
	const [screenshots] = createResource(
		() =>
			traceInfoData.state === "ready"
				? traceInfoData()?.loadScreenshots
				: undefined,
		(loadScreenshots) => loadScreenshots(),
		{ initialValue: [] },
	);
	const traceInfo = (): TraceInfo | undefined => {
		if (traceInfoData.state !== "ready") return undefined;
		const data = traceInfoData();
		if (!data) return undefined;
		return {
			testInfo: data.testInfo,
			traceData: data.traceData,
			screenshots,
		};
	};

	return (
		<Switch>
			<Match when={traceInfoData.loading}>
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
			<Match when={traceInfoData.error}>
				<NoTraceLoaded
					setTraceSource={props.setTraceSource}
					initialApiUrl={traceSourceUrl(props.source)}
					loadError={String(traceInfoData.error)}
				/>
			</Match>
			<Match when={traceInfo()}>{(info) => props.children(info())}</Match>
		</Switch>
	);
}

function traceSourceUrl(source: TraceSource): string | undefined {
	switch (source.kind) {
		case "remote-api":
		case "remote-zip":
			return source.url;
		case "local-zip":
			return undefined;
	}
}

export function useTraceInfoLoader(
	source: () => TraceSource | null,
): Resource<TraceInfoData | undefined> {
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

async function loadTraceSource(source: TraceSource): Promise<TraceInfoData> {
	switch (source.kind) {
		case "local-zip":
			return loadLocalZip(source.file);
		case "remote-zip":
			return loadRemoteZip(source.url);
		case "remote-api":
			return loadRemoteApi(source.url);
	}
}
