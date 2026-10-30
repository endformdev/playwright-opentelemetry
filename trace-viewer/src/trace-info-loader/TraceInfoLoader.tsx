import {
	createEffect,
	createResource,
	type Accessor,
	onCleanup,
	type Resource,
} from "solid-js";
import type { TraceSource } from "../trace-source";
import type { OtlpExport } from "../trace-data-loader";
import { loadRemoteApi } from "./traceInfoDataLoaders/apiLoader";
import {
	type LiveTraceSession,
	loadLiveTrace,
} from "./traceInfoDataLoaders/liveLoader";
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
	/** Present while a live trace streams; its accessors replace the fields above. */
	live?: LiveTraceSession;
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
	| "interrupted"
	/** A live trace whose test hasn't ended yet */
	| "running";

export interface ScreenshotInfo {
	timestamp: number;
	url: string;
	pageId: string;
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
	const [screenshots, { mutate: setScreenshots }] = createResource(
		() =>
			traceInfoData.state === "ready"
				? traceInfoData()?.loadScreenshots
				: undefined,
		(loadScreenshots) => loadScreenshots(),
		{ initialValue: [] },
	);

	// A live trace keeps receiving screenshots and closes when replaced.
	createEffect(() => {
		const live =
			traceInfoData.state === "ready" ? traceInfoData()?.live : undefined;
		if (!live) return;
		createEffect(() => setScreenshots(live.screenshots()));
		onCleanup(() => live.close());
	});

	const traceInfo = (): TraceInfo | undefined => {
		if (traceInfoData.state !== "ready") return undefined;
		const data = traceInfoData();
		if (!data) return undefined;
		return {
			testInfo: data.live ? data.live.testInfo() : data.testInfo,
			traceData: data.live ? data.live.traceData() : data.traceData,
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
		case "remote-live":
			return loadLiveTrace(source.url, source.traceToken);
	}
}
