import { deriveTestInfoFromOtlpExport } from "../deriveTestInfo";
import { loadTraceZipData } from "../rrwebZip";
import type { TraceInfoData } from "../TraceInfoLoader";

export async function loadLocalZip(file: File): Promise<TraceInfoData> {
	return loadZipBlob(file);
}

export async function loadRemoteZip(url: string): Promise<TraceInfoData> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`Failed to fetch trace ZIP from ${url}: ${response.status} ${response.statusText}`,
		);
	}
	return loadZipBlob(await response.blob());
}

async function loadZipBlob(zip: Blob): Promise<TraceInfoData> {
	const { traceData, rrweb } = await loadTraceZipData(zip);
	return {
		testInfo: deriveTestInfoFromOtlpExport(traceData),
		traceData,
		rrweb,
	};
}
