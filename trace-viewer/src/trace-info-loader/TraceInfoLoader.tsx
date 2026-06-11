import {
	createResource,
	type Accessor,
	onCleanup,
	type Resource,
} from "solid-js";
import type { TraceSource } from "../trace-source";
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

export interface TraceInfoLoaderResult {
	traceInfoData: Resource<TraceInfoData | undefined>;
	traceInfo: Accessor<TraceInfo | undefined>;
}

export function useTraceInfoLoader(
	source: () => TraceSource | null,
): TraceInfoLoaderResult {
	const [traceInfoData] = createResource(source, async (src) => {
		if (!src) return undefined;
		return loadTraceSource(src);
	});
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

	// Cleanup: unload trace from service worker when component unmounts
	onCleanup(() => {
		unloadCurrentTrace();
	});

	return { traceInfoData, traceInfo };
}

async function loadTraceSource(source: TraceSource): Promise<TraceInfoData> {
	switch (source.kind) {
		case "local-zip":
			return loadLocalZip(source.file);
		case "remote-zip":
			return loadRemoteZip(source.url);
		case "remote-api":
			return loadRemoteApi(source.url, source.traceToken);
	}
}
