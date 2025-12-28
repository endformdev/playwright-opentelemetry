import type { ScreenshotInfo, TestInfo, TraceInfo } from "../TraceInfoLoader";

const TEST_JSON_PATH = "test.json";
const OTEL_PROTOCOL_PATH = "opentelemetry-protocol";
const SCREENSHOTS_PATH = "screenshots";

/**
 * Response format from GET {baseUrl}/opentelemetry-protocol
 */
interface OtelProtocolListResponse {
	jsonFiles: string[];
}

/**
 * Response format from GET {baseUrl}/screenshots
 */
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

	try {
		const otelResponse = await fetch(otelListUrl);
		if (otelResponse.ok) {
			const otelList: OtelProtocolListResponse = await otelResponse.json();
			traceDataUrls = otelList.jsonFiles.map(
				(file) => `${normalizedBaseUrl}/${OTEL_PROTOCOL_PATH}/${file}`,
			);
		}
	} catch {
		// Fallback to default trace file if list endpoint fails
		console.warn(
			"Could not fetch trace list from",
			otelListUrl,
			"- using default",
		);
		traceDataUrls = [
			`${normalizedBaseUrl}/${OTEL_PROTOCOL_PATH}/playwright-opentelemetry.json`,
		];
	}

	// If no trace files found, use the default
	if (traceDataUrls.length === 0) {
		traceDataUrls = [
			`${normalizedBaseUrl}/${OTEL_PROTOCOL_PATH}/playwright-opentelemetry.json`,
		];
	}

	// Fetch the list of screenshots
	const screenshotsListUrl = `${normalizedBaseUrl}/${SCREENSHOTS_PATH}`;
	const screenshots: ScreenshotInfo[] = [];

	try {
		const response = await fetch(screenshotsListUrl);
		if (response.ok) {
			const screenshotsList: ScreenshotsListResponse = await response.json();
			for (const screenshot of screenshotsList.screenshots) {
				screenshots.push({
					timestamp: screenshot.timestamp,
					url: `${normalizedBaseUrl}/${SCREENSHOTS_PATH}/${screenshot.file}`,
				});
			}
		}
	} catch {
		// Screenshots are optional, continue without them
		console.warn("Could not fetch screenshot list from", screenshotsListUrl);
	}

	// Sort screenshots by timestamp
	screenshots.sort((a, b) => a.timestamp - b.timestamp);

	return {
		testInfo,
		traceDataUrls,
		screenshots,
	};
}
