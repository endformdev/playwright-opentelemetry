import { parseOtlpExport } from "../../trace-data-loader";
import { deriveTestInfoFromOtlpExport } from "../deriveTestInfo";
import type { ScreenshotInfo, TraceInfo } from "../TraceInfoLoader";

const TRACES_PATH = "traces";
const SCREENSHOTS_PATH = "screenshots";

interface ScreenshotsListResponse {
	screenshots: Array<{
		timestamp: number;
		file: string;
	}>;
}

export async function loadRemoteApi(baseUrl: string): Promise<TraceInfo> {
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

	// Fetch the list of screenshots
	const screenshotsListUrl = `${normalizedBaseUrl}/${SCREENSHOTS_PATH}`;
	const screenshots: ScreenshotInfo[] = [];

	const response = await fetch(screenshotsListUrl);
	if (!response.ok) {
		const body = await response.text();
		throw new Error(
			`Failed to fetch screenshots list from ${screenshotsListUrl}: ${response.statusText} ${body}`,
		);
	}
	const screenshotsList: ScreenshotsListResponse = await response.json();
	for (const screenshot of screenshotsList.screenshots) {
		screenshots.push({
			timestamp: screenshot.timestamp,
			url: `${normalizedBaseUrl}/${SCREENSHOTS_PATH}/${screenshot.file}`,
		});
	}

	// Sort screenshots by timestamp
	screenshots.sort((a, b) => a.timestamp - b.timestamp);

	return {
		testInfo,
		traceData,
		screenshots,
	};
}
