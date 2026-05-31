import type { OtlpExport } from "../../trace-data-loader";
import { deriveTestInfoFromOtlpExports } from "../deriveTestInfo";
import type { ScreenshotInfo, TraceInfo } from "../TraceInfoLoader";

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
	const otlpExports = await Promise.all(
		traceDataUrls.map(async (url) => {
			const response = await fetch(url);
			if (!response.ok) {
				const body = await response.text();
				throw new Error(
					`Failed to fetch trace data from ${url}: ${response.status} ${body}`,
				);
			}
			return (await response.json()) as OtlpExport;
		}),
	);
	const testInfo = deriveTestInfoFromOtlpExports(otlpExports);

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
