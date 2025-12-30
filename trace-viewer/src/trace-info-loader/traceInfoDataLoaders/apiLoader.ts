import type { ScreenshotInfo, TestInfo, TraceInfo } from "../TraceInfoLoader";

const TEST_JSON_PATH = "test.json";
const OTEL_PROTOCOL_PATH = "opentelemetry-protocol";
const SCREENSHOTS_PATH = "screenshots";

interface OpentelemetryProtocolListResponse {
	jsonFiles: string[];
}

interface ScreenshotsListResponse {
	screenshots: Array<{
		timestamp: number;
		file: string;
	}>;
}

export async function loadRemoteApi(baseUrl: string): Promise<TraceInfo> {
	// Normalize base URL (remove trailing slash)
	const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

	// Fetch test.json (required)
	const testJsonUrl = `${normalizedBaseUrl}/${TEST_JSON_PATH}`;
	const testResponse = await fetch(testJsonUrl);
	if (!testResponse.ok) {
		throw new Error(
			`Failed to fetch test info from ${testJsonUrl}: ${testResponse.statusText}`,
		);
	}
	const testInfo: TestInfo = await testResponse.json();

	// Fetch list of trace files from the opentelemetry-protocol endpoint
	const otelListUrl = `${normalizedBaseUrl}/${OTEL_PROTOCOL_PATH}`;
	let traceDataUrls: string[] = [];

	const otelResponse = await fetch(otelListUrl);
	if (!otelResponse.ok) {
		const body = await otelResponse.text();
		throw new Error(
			`Failed to fetch trace list from ${otelListUrl}: ${otelResponse.statusText} ${body}`,
		);
	}

	const otelList: OpentelemetryProtocolListResponse = await otelResponse.json();
	traceDataUrls = otelList.jsonFiles.map(
		(file) => `${normalizedBaseUrl}/${OTEL_PROTOCOL_PATH}/${file}`,
	);

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
		traceDataUrls,
		screenshots,
	};
}
