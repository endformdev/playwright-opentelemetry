import { parseOtlpExport } from "../../trace-data-loader";
import { deriveTestInfoFromOtlpExport } from "../deriveTestInfo";
import type { ScreenshotInfo, TraceInfoData } from "../TraceInfoLoader";
import { ensureServiceWorker, loadScreenshotsForTrace } from "./zipLoader";

const TRACES_PATH = "traces";
const SCREENSHOTS_ZIP_PATH = "screenshots.zip";

export async function loadRemoteApi(
	baseUrl: string,
	traceToken: string | null,
): Promise<TraceInfoData> {
	// Normalize base URL (remove trailing slash)
	const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

	const tracesUrl = withTraceToken(
		`${normalizedBaseUrl}/${TRACES_PATH}`,
		traceToken,
	);
	const tracesResponse = await fetch(tracesUrl);
	if (!tracesResponse.ok) {
		const body = await tracesResponse.text();
		throw new Error(
			`Failed to fetch trace data from ${tracesUrl}: ${tracesResponse.status} ${body}`,
		);
	}
	const traceData = parseOtlpExport(await tracesResponse.json());
	const testInfo = deriveTestInfoFromOtlpExport(traceData);
	const screenshotsZipUrl = withTraceToken(
		`${normalizedBaseUrl}/${SCREENSHOTS_ZIP_PATH}`,
		traceToken,
	);

	return {
		testInfo,
		traceData,
		loadScreenshots: () =>
			loadScreenshotsFromApi({
				traceId: testInfo.traceId,
				screenshotsZipUrl,
			}),
	};
}

function withTraceToken(url: string, traceToken: string | null): string {
	if (traceToken === null) return url;
	return `${url}?traceToken=${encodeURIComponent(traceToken)}`;
}

async function loadScreenshotsFromApi({
	traceId,
	screenshotsZipUrl,
}: {
	traceId: string;
	screenshotsZipUrl: string;
}): Promise<ScreenshotInfo[]> {
	try {
		await ensureServiceWorker();
		return await loadScreenshotsForTrace(traceId, screenshotsZipUrl);
	} catch (error) {
		console.warn(
			`Failed to load screenshots ZIP: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}
