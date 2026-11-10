import {
	createResource,
	type Accessor,
	onCleanup,
	type Resource,
} from "solid-js";
import type { TraceSource } from "../trace-source";
import type { OtlpExport } from "../trace-data-loader";
import { loadRemoteApi } from "./traceInfoDataLoaders/apiLoader";
import type { TraceSlot } from "./traceInfoDataLoaders/pageScreenshots";
import {
	loadLocalZip,
	loadRemoteZip,
	unloadTrace,
} from "./traceInfoDataLoaders/zipLoader";

export type { TraceSlot };

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
	pageId: string;
}

export interface TraceInfoLoaderResult {
	traceInfoData: Resource<TraceInfoData | undefined>;
	traceInfo: Accessor<TraceInfo | undefined>;
}

/**
 * Loads the trace a source names into a slot. The viewer has two: the primary,
 * and a comparison shown beside it, each keeping its own screenshots.
 */
export function useTraceInfoLoader(
	source: () => TraceSource | null,
	slot: TraceSlot = "primary",
): TraceInfoLoaderResult {
	const [traceInfoData] = createResource(source, async (src) => {
		if (!src) return undefined;
		return loadTraceSource(src, slot);
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

	// Cleanup: release the slot's screenshots when component unmounts
	onCleanup(() => {
		unloadTrace(slot);
	});

	return { traceInfoData, traceInfo };
}

async function loadTraceSource(
	source: TraceSource,
	slot: TraceSlot,
): Promise<TraceInfoData> {
	switch (source.kind) {
		case "local-zip":
			if (slot !== "primary") {
				throw new Error("A local ZIP can't be a comparison");
			}
			return loadLocalZip(source.file);
		case "remote-zip":
			return loadRemoteZip(source.url, slot);
		case "remote-api":
			return loadRemoteApi(source.url, source.traceToken, slot);
	}
}
