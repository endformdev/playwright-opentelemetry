import { type Accessor, createMemo } from "solid-js";
import { useTraceDataLoader } from "../trace-data-loader/useTraceDataLoader";
import type { ScreenshotInfo, TraceInfo } from "../trace-info-loader";
import {
	findCounterpartPage,
	findScreenshotAtTime,
	groupScreenshotsByPage,
} from "./screenshots";
import { matchableSteps, matchSteps, type StepMatch } from "./stepMatching";
import { buildTestStructure, type TestStructure } from "./testStructure";
import { buildTimeMapping, type TimeMapping } from "./timeMapping";
import type { ViewerComparison } from "./viewerComparison";

export interface TraceComparisonOptions {
	comparison: Accessor<ViewerComparison | null>;
	/** The primary run, which the comparison follows */
	structure: Accessor<TestStructure>;
	durationMs: Accessor<number>;
	passed: Accessor<boolean>;
	/** Whether the primary's steps have loaded */
	loaded: Accessor<boolean>;
	/** Whether the comparison is on screen */
	enabled: Accessor<boolean>;
}

/** What the comparison shows for a moment of the primary. */
export interface ComparisonFrame {
	/** The same moment in the comparison, relative to its test start */
	timeMs: number | null;
	/** Its frame at that moment, or null without one */
	screenshot: ScreenshotInfo | null;
}

export type ComparisonNote = "No matching step" | "Approximate timing";

export interface TraceComparison {
	/** The comparison's trace once it has loaded */
	traceInfo: Accessor<TraceInfo | undefined>;
	/** Whether the comparison has loaded far enough to follow the primary */
	ready: Accessor<boolean>;
	/**
	 * The comparison's frame for a moment of the primary, from the page that
	 * stands for the primary's page on show
	 */
	frame: (
		primaryTimeMs: number | null,
		primaryPage: { pageId: string; number: number } | null,
	) => ComparisonFrame;
	/** Says when the comparison can't follow the primary's step closely */
	note: (primaryStepId: string | null) => ComparisonNote | null;
}

/**
 * Follows the primary run in a comparison run: their steps are matched and
 * time is mapped from one to the other (see stepMatching.ts and
 * timeMapping.ts), so whatever moment the primary shows, the comparison shows
 * the same moment of its own run.
 */
export function useTraceComparison(
	options: TraceComparisonOptions,
): TraceComparison {
	// The same trace stays the same, however often the loader hands it over.
	const traceInfo = createMemo(
		() => {
			const comparison = options.comparison();
			return comparison?.status === "ready" ? comparison.traceInfo : undefined;
		},
		undefined,
		{ equals: (a, b) => a?.traceData === b?.traceData },
	);
	const traceData = useTraceDataLoader(traceInfo);
	const structure = createMemo(() => buildTestStructure(traceData.steps()));
	const testStartTimeMs = () => {
		const info = traceInfo();
		return info
			? Number(BigInt(info.testInfo.startTimeUnixNano) / BigInt(1_000_000))
			: 0;
	};
	const screenshots = () => traceInfo()?.screenshots() ?? [];
	const pages = createMemo(() => groupScreenshotsByPage(screenshots()));

	// Matching is done once per pair of traces, from when it's first wanted.
	const wanted = createMemo((was: boolean) => was || options.enabled(), false);
	const alignment = createMemo(
		(): { match: StepMatch; mapping: TimeMapping } | null => {
			const info = traceInfo();
			if (!wanted() || !info || !options.loaded()) return null;
			if (traceData.status() !== "loaded") return null;
			const primarySteps = matchableSteps(options.structure());
			const comparisonSteps = matchableSteps(structure());
			const match = matchSteps(primarySteps, comparisonSteps);
			const mapping = buildTimeMapping(
				{
					structure: options.structure(),
					steps: primarySteps,
					durationMs: options.durationMs(),
					passed: options.passed(),
				},
				{
					structure: structure(),
					steps: comparisonSteps,
					durationMs: traceData.totalDurationMs(),
					passed: info.testInfo.status === "passed",
				},
				match,
			);
			return { match, mapping };
		},
	);
	const primaryStepIds = createMemo(
		() => new Set(matchableSteps(options.structure()).map((step) => step.id)),
	);

	return {
		traceInfo,
		ready: () => alignment() !== null,
		frame: (primaryTimeMs, primaryPage) => {
			const mapping = alignment()?.mapping;
			if (!mapping || primaryTimeMs === null) {
				return { timeMs: null, screenshot: null };
			}
			const timeMs = mapping.comparisonTimeAt(primaryTimeMs);
			const page = findCounterpartPage(pages(), primaryPage);
			return {
				timeMs,
				screenshot: findScreenshotAtTime(
					page?.screenshots ?? screenshots(),
					testStartTimeMs() + timeMs,
				),
			};
		},
		note: (primaryStepId) => {
			const current = alignment();
			if (!current) return null;
			if (!current.mapping.hasStepAnchors) return "Approximate timing";
			// Requests aren't matched, so they have no counterpart to miss.
			return primaryStepId !== null &&
				primaryStepIds().has(primaryStepId) &&
				!current.match.byPrimaryId.has(primaryStepId)
				? "No matching step"
				: null;
		},
	};
}
