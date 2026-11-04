/**
 * Which regions of the trace viewer are shown, controlled by the `panels`
 * query parameter (e.g. `?panels=viewer,filmstrip`).
 *
 * This is read-only layout configuration intended for embedding: it is read
 * once when the viewer mounts and is never written back to the URL.
 */

export const VIEWER_PANEL_IDS = [
	/** Top bar: test name, status, error spans, search, time readout */
	"header",
	/** Timeline ruler with the test phase bar */
	"ruler",
	/** Screenshot filmstrip rows */
	"filmstrip",
	/** Large screenshot for the current hover or locked time */
	"viewer",
	/** Test steps timeline */
	"steps",
	/** Browser spans timeline */
	"browser",
	/** External (non-browser) spans timeline */
	"external",
	/** Span details sidebar */
	"details",
] as const;

export type ViewerPanelId = (typeof VIEWER_PANEL_IDS)[number];

export type ViewerPanels = Record<ViewerPanelId, boolean>;

export const VIEWER_PANELS_QUERY_PARAM_NAME = "panels";

/** Panels laid out along the time axis. Listing any of them also shows the ruler. */
const TIMELINE_PANEL_IDS: readonly ViewerPanelId[] = [
	"filmstrip",
	"steps",
	"browser",
	"external",
];

export const ALL_VIEWER_PANELS: ViewerPanels = Object.freeze(
	Object.fromEntries(VIEWER_PANEL_IDS.map((id) => [id, true])) as ViewerPanels,
);

function isViewerPanelId(value: string): value is ViewerPanelId {
	return (VIEWER_PANEL_IDS as readonly string[]).includes(value);
}

/**
 * Parses a comma-separated panel list. Unknown names are ignored. A missing
 * value, or one with no recognised panel names, shows every panel so that a
 * typo never results in an empty viewer. The ruler is shown whenever a
 * timeline panel is listed, so its time axis is always there to read them by.
 */
export function parseViewerPanels(value: string | null): ViewerPanels {
	if (value === null) return ALL_VIEWER_PANELS;

	const requested = value
		.split(",")
		.map((part) => part.trim().toLowerCase())
		.filter(isViewerPanelId);

	if (requested.length === 0) return ALL_VIEWER_PANELS;

	const panels = Object.fromEntries(
		VIEWER_PANEL_IDS.map((id) => [id, requested.includes(id)]),
	) as ViewerPanels;
	if (TIMELINE_PANEL_IDS.some((id) => panels[id])) panels.ruler = true;
	return panels;
}

export function readViewerPanelsFromQueryParam(): ViewerPanels {
	if (typeof window === "undefined") return ALL_VIEWER_PANELS;
	const params = new URLSearchParams(window.location.search);
	return parseViewerPanels(params.get(VIEWER_PANELS_QUERY_PARAM_NAME));
}
