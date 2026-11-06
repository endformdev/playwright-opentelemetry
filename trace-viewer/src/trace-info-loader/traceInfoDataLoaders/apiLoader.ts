import { parseOtlpExport } from "../../trace-data-loader";
import { deriveTestInfoFromOtlpExport } from "../deriveTestInfo";
import type { ScreenshotInfo, TraceInfoData } from "../TraceInfoLoader";
import { parseTraceAccessFailure, TraceAccessError } from "../traceAccessError";
import { loadScreenshotsInPage } from "./pageScreenshots";
import { ensureServiceWorker, loadScreenshotsForTrace } from "./zipLoader";

const TRACES_PATH = "traces";
const SCREENSHOTS_ZIP_PATH = "screenshots.zip";
/** How long a service worker gets to take control of the page. */
const SERVICE_WORKER_TIMEOUT_MS = 10000;

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
		const accessFailure = parseTraceAccessFailure(body);
		if (accessFailure) throw new TraceAccessError(accessFailure);

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
		if (await canUseServiceWorker()) {
			return await loadScreenshotsForTrace(traceId, screenshotsZipUrl);
		}
		return await loadScreenshotsInPage(screenshotsZipUrl);
	} catch (error) {
		console.warn(
			`Failed to load screenshots ZIP: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * Whether a service worker is controlling the page. It's unavailable in a
 * sandboxed iframe or outside a secure context, and one that registers can
 * still fail to take control.
 */
async function canUseServiceWorker(): Promise<boolean> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			ensureServiceWorker(),
			new Promise((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error("Timeout waiting for service worker")),
					SERVICE_WORKER_TIMEOUT_MS,
				);
			}),
		]);
		return true;
	} catch (error) {
		console.info(
			`Loading screenshots in the page: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	} finally {
		clearTimeout(timeout);
	}
}
