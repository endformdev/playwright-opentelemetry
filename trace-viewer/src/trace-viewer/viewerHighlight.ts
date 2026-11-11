/**
 * Lets the page linking to the viewer point at one span, with the
 * `highlightSpanId` query parameter (e.g. `?highlightSpanId=0af7651916cd43dd`).
 * The viewer opens on that span and marks where it starts on the step ruler,
 * labelled with `highlightSpanLabel` when given. By default it opens on the span's
 * result, after the last step inside it; `highlightSpanAt=start` opens on its
 * start instead. A span the trace doesn't contain is ignored.
 */

export const VIEWER_HIGHLIGHT_SPAN_ID_QUERY_PARAM_NAME = "highlightSpanId";
export const VIEWER_HIGHLIGHT_SPAN_LABEL_QUERY_PARAM_NAME =
	"highlightSpanLabel";
export const VIEWER_HIGHLIGHT_SPAN_AT_QUERY_PARAM_NAME = "highlightSpanAt";

const DEFAULT_HIGHLIGHT_LABEL = "Highlighted step";
const MAX_HIGHLIGHT_LABEL_LENGTH = 80;

export interface ViewerHighlight {
	spanId: string;
	label: string;
	/** Where the viewer opens: the span's start, or its result */
	at: "start" | "end";
}

/** The highlight named by the query parameters, or null without a span. */
export function parseViewerHighlight(
	params: URLSearchParams,
): ViewerHighlight | null {
	const spanId = params.get(VIEWER_HIGHLIGHT_SPAN_ID_QUERY_PARAM_NAME)?.trim();
	if (!spanId) return null;

	const label =
		params
			.get(VIEWER_HIGHLIGHT_SPAN_LABEL_QUERY_PARAM_NAME)
			?.trim()
			.slice(0, MAX_HIGHLIGHT_LABEL_LENGTH) || DEFAULT_HIGHLIGHT_LABEL;
	const at =
		params.get(VIEWER_HIGHLIGHT_SPAN_AT_QUERY_PARAM_NAME)?.trim() === "start"
			? "start"
			: "end";
	return { spanId, label, at };
}

export function readViewerHighlightFromQueryParams(): ViewerHighlight | null {
	if (typeof window === "undefined") return null;
	return parseViewerHighlight(new URLSearchParams(window.location.search));
}
