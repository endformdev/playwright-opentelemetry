import type { ResolvedTraceUrls } from "../TraceLoader";

const TRACE_PATH = "opentelemetry-protocol/playwright-opentelemetry.json";
const SCREENSHOTS_PATH = "screenshots";

export async function loadRemoteApi(
	baseUrl: string,
): Promise<ResolvedTraceUrls> {
	// Normalize base URL (remove trailing slash)
	const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

	// Fetch the list of screenshots
	const screenshotsListUrl = `${normalizedBaseUrl}/${SCREENSHOTS_PATH}`;
	let screenshotFilenames: string[] = [];

	try {
		const response = await fetch(screenshotsListUrl);
		if (response.ok) {
			screenshotFilenames = await response.json();
		}
	} catch {
		// Screenshots are optional, continue without them
		console.warn("Could not fetch screenshot list from", screenshotsListUrl);
	}

	// Build screenshot URLs map
	const screenshotUrls = new Map<string, string>();
	for (const filename of screenshotFilenames) {
		screenshotUrls.set(
			filename,
			`${normalizedBaseUrl}/${SCREENSHOTS_PATH}/${filename}`,
		);
	}

	// Build trace data URL
	const traceDataUrls = [`${normalizedBaseUrl}/${TRACE_PATH}`];

	return {
		traceDataUrls,
		screenshotUrls,
	};
}
