import type { TraceInfo } from "../trace-info-loader";

/**
 * Lets the page linking to the viewer compare the trace with another one, as
 * `compareSource` and `compareToken` (read with the trace source, see
 * traceSource.ts). The comparison's screenshots are shown beside the trace's
 * own on the big screen, captioned with `compareLabel` when given.
 */

export const COMPARE_LABEL_QUERY_PARAM_NAME = "compareLabel";

const DEFAULT_COMPARISON_LABEL = "Baseline";
const MAX_COMPARISON_LABEL_LENGTH = 80;

/** The comparison trace, as the viewer is handed it while it loads. */
export type ViewerComparison =
	| { status: "loading"; label: string }
	| { status: "failed"; label: string }
	| { status: "ready"; label: string; traceInfo: TraceInfo };

/** The caption of the comparison, from the query parameters. */
export function parseComparisonLabel(params: URLSearchParams): string {
	return (
		params
			.get(COMPARE_LABEL_QUERY_PARAM_NAME)
			?.trim()
			.slice(0, MAX_COMPARISON_LABEL_LENGTH) || DEFAULT_COMPARISON_LABEL
	);
}

export function readComparisonLabelFromQueryParams(): string {
	if (typeof window === "undefined") return DEFAULT_COMPARISON_LABEL;
	return parseComparisonLabel(new URLSearchParams(window.location.search));
}
