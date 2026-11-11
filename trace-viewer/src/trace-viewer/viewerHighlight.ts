/**
 * Lets the page linking to the viewer point at one span, with the
 * `highlightSpanId` query parameter (e.g. `?highlightSpanId=0af7651916cd43dd`).
 * The viewer opens on that span and marks where it starts on the step ruler,
 * labelled with `highlightSpanLabel` when given. A span the trace doesn't contain
 * is ignored.
 */

export const VIEWER_HIGHLIGHT_SPAN_ID_QUERY_PARAM_NAME = "highlightSpanId";
export const VIEWER_HIGHLIGHT_SPAN_LABEL_QUERY_PARAM_NAME =
	"highlightSpanLabel";

const DEFAULT_HIGHLIGHT_LABEL = "Highlighted step";
const MAX_HIGHLIGHT_LABEL_LENGTH = 80;

export interface ViewerHighlight {
	spanId: string;
	label: string;
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
	return { spanId, label };
}

export function readViewerHighlightFromQueryParams(): ViewerHighlight | null {
	if (typeof window === "undefined") return null;
	return parseViewerHighlight(new URLSearchParams(window.location.search));
}
