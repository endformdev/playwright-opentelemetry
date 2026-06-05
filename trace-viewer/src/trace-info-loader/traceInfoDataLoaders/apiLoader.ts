import { createSignal } from "solid-js";
import { parseOtlpExport } from "../../trace-data-loader";
import { deriveTestInfoFromOtlpExport } from "../deriveTestInfo";
import type { ScreenshotInfo, TraceInfo } from "../TraceInfoLoader";
import {
	ensureServiceWorker,
	loadScreenshotsZipForTrace,
	unloadCurrentTrace,
} from "./zipLoader";

const TRACES_PATH = "traces";
const SCREENSHOTS_ZIP_PATH = "screenshots.zip";

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
	const [screenshots, setScreenshots] = createSignal<ScreenshotInfo[]>([]);

	void loadScreenshotsFromApi(
		normalizedBaseUrl,
		testInfo.traceId,
		setScreenshots,
	);

	return {
		testInfo,
		traceData,
		screenshots,
	};
}

async function loadScreenshotsFromApi(
	normalizedBaseUrl: string,
	traceId: string,
	setScreenshots: (screenshots: ScreenshotInfo[]) => void,
): Promise<void> {
	try {
		await ensureServiceWorker();
		await unloadCurrentTrace();

		const screenshotsZipUrl = `${normalizedBaseUrl}/${SCREENSHOTS_ZIP_PATH}`;
		const response = await fetch(screenshotsZipUrl);
		if (response.status === 404) {
			setScreenshots([]);
			return;
		}
		if (!response.ok) {
			console.warn(
				`Failed to fetch screenshots ZIP from ${screenshotsZipUrl}: ${response.statusText}`,
			);
			setScreenshots([]);
			return;
		}

		const loadedScreenshots = await loadScreenshotsZipForTrace(
			traceId,
			await response.blob(),
		);
		setScreenshots(loadedScreenshots);
	} catch (error) {
		console.warn(
			`Failed to load screenshots ZIP: ${error instanceof Error ? error.message : String(error)}`,
		);
		setScreenshots([]);
	}
}
