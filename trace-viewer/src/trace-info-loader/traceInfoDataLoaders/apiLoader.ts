import { parseOtlpExport } from "../../trace-data-loader";
import { deriveTestInfoFromOtlpExport } from "../deriveTestInfo";
import { EMPTY_RRWEB_TRACE, type RrwebTrace } from "../rrwebRecording";
import { loadRrwebZipData } from "../rrwebZip";
import type { TraceInfoData } from "../TraceInfoLoader";

const TRACES_PATH = "traces";
const RRWEB_ZIP_PATH = "rrweb.zip";

export async function loadRemoteApi(baseUrl: string): Promise<TraceInfoData> {
	// Normalize base URL (remove trailing slash)
	const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

	const tracesUrl = `${normalizedBaseUrl}/${TRACES_PATH}`;
	const tracesResponse = await fetch(tracesUrl);
	if (!tracesResponse.ok) {
		const body = await tracesResponse.text();
		throw new Error(
			`Failed to fetch trace data from ${tracesUrl}: ${tracesResponse.status} ${body}`,
		);
	}
	const traceData = parseOtlpExport(await tracesResponse.json());
	const testInfo = deriveTestInfoFromOtlpExport(traceData);
	const rrwebZipUrl = `${normalizedBaseUrl}/${RRWEB_ZIP_PATH}`;

	return {
		testInfo,
		traceData,
		rrweb: await loadRrwebFromApi(rrwebZipUrl),
	};
}

async function loadRrwebFromApi(rrwebZipUrl: string): Promise<RrwebTrace> {
	const response = await fetch(rrwebZipUrl);
	if (response.status === 404) {
		return EMPTY_RRWEB_TRACE;
	}
	if (!response.ok) {
		throw new Error(
			`Failed to fetch rrweb ZIP from ${rrwebZipUrl}: ${response.status} ${response.statusText}`,
		);
	}
	return loadRrwebZipData(await response.blob());
}
