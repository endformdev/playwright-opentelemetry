/**
 * SolidJS store for trace data state management.
 */

import { createSignal, createMemo } from "solid-js";
import type {
	ParsedTrace,
	Span,
	Screenshot,
	TestInfo,
	TimeRange,
} from "../types/trace";
import type { OtlpTraceExport } from "../types/otel";
import { loadZipFile } from "../services/dataLoader/zipLoader";
import { parseOtlpTrace, createScreenshots } from "../services/traceParser";
import {
	registerServiceWorker,
	loadTraceInServiceWorker,
	unloadTraceFromServiceWorker,
	generateTraceId,
	getScreenshotUrl,
} from "../services/serviceWorker/register";

/**
 * Loading state for the trace
 */
export type LoadingState =
	| { status: "idle" }
	| { status: "loading"; progress: number }
	| { status: "loaded" }
	| { status: "error"; error: string };

/**
 * Raw data before parsing (for JSON display)
 */
export interface RawTraceData {
	otlpJson: OtlpTraceExport;
	screenshotFilenames: string[];
}

// Signals for trace state
const [loadingState, setLoadingState] = createSignal<LoadingState>({
	status: "idle",
});
const [parsedTrace, setParsedTrace] = createSignal<ParsedTrace | null>(null);
const [rawData, setRawData] = createSignal<RawTraceData | null>(null);
const [currentTraceId, setCurrentTraceId] = createSignal<string | null>(null);
const [serviceWorkerReady, setServiceWorkerReady] = createSignal(false);

/**
 * Initialize the service worker
 */
export async function initializeServiceWorker(): Promise<void> {
	try {
		await registerServiceWorker();
		setServiceWorkerReady(true);
	} catch (error) {
		console.error("Failed to register service worker:", error);
		// Continue without service worker - screenshots will be loaded via blob URLs
	}
}

/**
 * Load a trace from a ZIP file blob
 */
export async function loadTraceFromZip(zipBlob: Blob): Promise<void> {
	// Unload any existing trace
	await unloadCurrentTrace();

	setLoadingState({ status: "loading", progress: 0 });

	try {
		// Extract ZIP contents
		const zipResult = await loadZipFile(zipBlob, (done, total) => {
			setLoadingState({ status: "loading", progress: (done / total) * 50 });
		});

		setLoadingState({ status: "loading", progress: 50 });

		// Store raw data for JSON display
		setRawData({
			otlpJson: zipResult.traceData,
			screenshotFilenames: zipResult.screenshotFilenames,
		});

		// Generate trace ID for this session
		const traceId = generateTraceId();
		setCurrentTraceId(traceId);

		// Load screenshots into service worker if available
		let screenshotBaseUrl: string;
		if (serviceWorkerReady()) {
			await loadTraceInServiceWorker(
				traceId,
				zipResult.screenshots,
				zipResult.traceData,
			);
			screenshotBaseUrl = `/screenshots/${traceId}`;
		} else {
			// Fallback: create blob URLs for screenshots
			screenshotBaseUrl = "blob:";
			// Note: In this case, screenshot URLs would need special handling
		}

		setLoadingState({ status: "loading", progress: 75 });

		// Create screenshot objects with proper URLs
		const screenshots = createScreenshots(
			zipResult.screenshotFilenames,
			screenshotBaseUrl,
		);

		// Parse the OTLP trace data
		const trace = parseOtlpTrace(zipResult.traceData, screenshots);

		setParsedTrace(trace);
		setLoadingState({ status: "loaded" });
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Unknown error loading trace";
		setLoadingState({ status: "error", error: message });
		throw error;
	}
}

/**
 * Unload the current trace and clean up
 */
export async function unloadCurrentTrace(): Promise<void> {
	const traceId = currentTraceId();
	if (traceId && serviceWorkerReady()) {
		await unloadTraceFromServiceWorker(traceId);
	}

	setCurrentTraceId(null);
	setParsedTrace(null);
	setRawData(null);
	setLoadingState({ status: "idle" });
}

// Derived/computed values

/**
 * Get the current test info
 */
export const testInfo = createMemo<TestInfo | null>(() => {
	return parsedTrace()?.testInfo ?? null;
});

/**
 * Get the root span
 */
export const rootSpan = createMemo<Span | null>(() => {
	return parsedTrace()?.rootSpan ?? null;
});

/**
 * Get all spans as a flat map
 */
export const spans = createMemo<Map<string, Span>>(() => {
	return parsedTrace()?.spans ?? new Map();
});

/**
 * Get all screenshots
 */
export const screenshots = createMemo<Screenshot[]>(() => {
	return parsedTrace()?.screenshots ?? [];
});

/**
 * Get the time range
 */
export const timeRange = createMemo<TimeRange | null>(() => {
	return parsedTrace()?.timeRange ?? null;
});

/**
 * Get network spans (HTTP requests)
 */
export const networkSpans = createMemo<Span[]>(() => {
	const allSpans = spans();
	const result: Span[] = [];
	for (const span of allSpans.values()) {
		if (span.kind === "network") {
			result.push(span);
		}
	}
	return result.sort((a, b) => a.startTime - b.startTime);
});

// Export signals and state
export {
	loadingState,
	parsedTrace,
	rawData,
	currentTraceId,
	serviceWorkerReady,
};

// Export the URL helper for components
export { getScreenshotUrl };
