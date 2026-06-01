import { type Accessor, createEffect, on, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { TraceInfo } from "../trace-info-loader";
import { categorizeSpans } from "./categorizeSpans";
import type { Span } from "./exportToSpans";
import { otlpExportToSpans } from "./exportToSpans";

export type LoadStatus = "idle" | "loading" | "loaded" | "error";

interface TraceDataStore {
	status: LoadStatus;
	steps: Span[];
	browserSpans: Span[];
	externalSpans: Span[];
	totalDurationMs: number;
	error?: Error;
}

export interface TraceDataLoaderResult {
	status: Accessor<LoadStatus>;
	isLoading: Accessor<boolean>;
	steps: Accessor<Span[]>;
	browserSpans: Accessor<Span[]>;
	externalSpans: Accessor<Span[]>;
	totalDurationMs: Accessor<number>;
	error: Accessor<Error | undefined>;
}

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

			// Initialize store for loading
			setStore({
				status: "loading",
				steps: [],
				browserSpans: [],
				externalSpans: [],
				totalDurationMs,
				error: undefined,
			});

			loadTraceData(info, testStartTimeMs, signal, setStore);
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
		isLoading: () => store.status === "loading",
		steps: () => store.steps,
		browserSpans: () => store.browserSpans,
		externalSpans: () => store.externalSpans,
		totalDurationMs: () => store.totalDurationMs,
		error: () => store.error,
	};
}

async function loadTraceData(
	traceInfo: TraceInfo,
	testStartTimeMs: number,
	signal: AbortSignal,
	setStore: ReturnType<typeof createStore<TraceDataStore>>[1],
): Promise<void> {
	try {
		if (signal.aborted) return;

		const spans = otlpExportToSpans(traceInfo.traceData, testStartTimeMs);
		const result = categorizeSpans(spans);

		if (signal.aborted) return;

		setStore(
			produce((state) => {
				state.steps = result.steps;
				state.browserSpans = result.browserSpans;
				state.externalSpans = result.externalSpans;
				state.status = "loaded";
			}),
		);
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
		steps: [],
		browserSpans: [],
		externalSpans: [],
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
