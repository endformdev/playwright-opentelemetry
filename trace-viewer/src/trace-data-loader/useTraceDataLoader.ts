import { type Accessor, createEffect, on, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { TraceInfo } from "../trace-info-loader";
import { mergeSpans } from "./categorizeSpans";
import { fetchTraceData } from "./fetchTraceData";
import type { NormalizedSpan } from "./normalizeSpans";

export type LoadStatus = "idle" | "loading" | "loaded" | "error";

interface TraceDataStore {
	/** Current loading status */
	status: LoadStatus;
	/** Number of trace data URLs that have been loaded */
	loadedUrls: number;
	/** Total number of trace data URLs to load */
	totalUrls: number;
	/** Spans categorized as "steps" (playwright.test and playwright.test.step) */
	steps: NormalizedSpan[];
	/** Spans categorized as "spans" (HTTP, DB, RPC, etc. - everything else) */
	spans: NormalizedSpan[];
	/** Total duration in milliseconds (from TestInfo timestamps) */
	totalDurationMs: number;
	/** Error if loading failed */
	error?: Error;
}

export interface TraceDataLoaderResult {
	/** Current loading status */
	status: Accessor<LoadStatus>;
	/** Loading progress */
	progress: Accessor<{ loaded: number; total: number }>;
	/** Whether currently loading */
	isLoading: Accessor<boolean>;
	/** Playwright test/step spans for the Steps Timeline */
	steps: Accessor<NormalizedSpan[]>;
	/** Other spans (HTTP, DB, etc.) for the Spans panel */
	spans: Accessor<NormalizedSpan[]>;
	/** Total test duration in milliseconds */
	totalDurationMs: Accessor<number>;
	/** Error if loading failed */
	error: Accessor<Error | undefined>;
}

/**
 * Hook for loading and managing trace data from multiple URLs.
 *
 * Features:
 * - Fetches all trace data URLs in parallel
 * - Updates store incrementally as each URL completes
 * - Provides reactive accessors for UI binding
 * - Throws on any fetch error (as requested)
 *
 * @param traceInfo - Accessor for TraceInfo (reactive, may be undefined initially)
 * @returns Object with reactive accessors for loading state and span data
 *
 * @example
 * ```tsx
 * const traceData = useTraceDataLoader(() => props.traceInfo);
 *
 * return (
 *   <Show when={!traceData.isLoading()} fallback={<Loading />}>
 *     <StepsTimeline steps={traceData.steps()} />
 *     <SpansPanel spans={traceData.spans()} />
 *   </Show>
 * );
 * ```
 */
export function useTraceDataLoader(
	traceInfo: Accessor<TraceInfo | undefined>,
): TraceDataLoaderResult {
	const [store, setStore] = createStore<TraceDataStore>(
		createInitialTraceDataStore(),
	);

	// Track the current loading operation so we can cancel if traceInfo changes
	let abortController: AbortController | null = null;

	// Effect to trigger loading when traceInfo changes
	createEffect(
		on(traceInfo, (info) => {
			// Cancel any in-flight requests
			if (abortController) {
				abortController.abort();
			}

			if (!info) {
				// Reset to initial state if no traceInfo
				setStore(createInitialTraceDataStore());
				return;
			}

			// Start new loading operation
			abortController = new AbortController();
			const signal = abortController.signal;

			// Calculate values we need
			const testStartTimeMs = nanoToMs(info.testInfo.startTimeUnixNano);
			const totalDurationMs = calculateDuration(info);
			const urls = info.traceDataUrls;

			// Initialize store for loading
			setStore({
				status: "loading",
				loadedUrls: 0,
				totalUrls: urls.length,
				steps: [],
				spans: [],
				totalDurationMs,
				error: undefined,
			});

			// If no URLs, we're done
			if (urls.length === 0) {
				setStore("status", "loaded");
				return;
			}

			// Fetch all URLs in parallel, updating store incrementally
			loadAllUrls(urls, testStartTimeMs, signal, setStore);
		}),
	);

	// Cleanup on unmount
	onCleanup(() => {
		if (abortController) {
			abortController.abort();
		}
	});

	// Return reactive accessors
	return {
		status: () => store.status,
		progress: () => ({ loaded: store.loadedUrls, total: store.totalUrls }),
		isLoading: () => store.status === "loading",
		steps: () => store.steps,
		spans: () => store.spans,
		totalDurationMs: () => store.totalDurationMs,
		error: () => store.error,
	};
}

async function loadAllUrls(
	urls: string[],
	testStartTimeMs: number,
	signal: AbortSignal,
	setStore: ReturnType<typeof createStore<TraceDataStore>>[1],
): Promise<void> {
	// Create a promise for each URL that updates the store when done
	const fetchPromises = urls.map(async (url) => {
		// Check if aborted before starting
		if (signal.aborted) {
			return;
		}

		const result = await fetchTraceData(url, testStartTimeMs);

		// Check if aborted after fetch
		if (signal.aborted) {
			return;
		}

		// Update store with new spans (merge and increment counter)
		setStore(
			produce((state) => {
				const merged = mergeSpans(
					{ steps: state.steps, spans: state.spans },
					result,
				);
				state.steps = merged.steps;
				state.spans = merged.spans;
				state.loadedUrls += 1;
			}),
		);
	});

	try {
		// Wait for all fetches to complete
		await Promise.all(fetchPromises);

		// Check if aborted before marking complete
		if (signal.aborted) {
			return;
		}

		// All done
		setStore("status", "loaded");
	} catch (error) {
		// Check if aborted
		if (signal.aborted) {
			return;
		}

		// Store the error and mark as failed
		setStore(
			produce((state) => {
				state.status = "error";
				state.error = error instanceof Error ? error : new Error(String(error));
			}),
		);

		// Re-throw as requested (blow everything up)
		throw error;
	}
}

function createInitialTraceDataStore(): TraceDataStore {
	return {
		status: "idle",
		loadedUrls: 0,
		totalUrls: 0,
		steps: [],
		spans: [],
		totalDurationMs: 0,
	};
}

function nanoToMs(nanoStr: string): number {
	const nanos = BigInt(nanoStr);
	return Number(nanos / BigInt(1_000_000));
}

/**
 * Calculates test duration from TestInfo timestamps.
 */
function calculateDuration(traceInfo: TraceInfo): number {
	const startMs = nanoToMs(traceInfo.testInfo.startTimeUnixNano);
	const endMs = nanoToMs(traceInfo.testInfo.endTimeUnixNano);
	return endMs - startMs;
}
