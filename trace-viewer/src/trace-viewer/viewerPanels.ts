/**
 * Which regions of the trace viewer are shown, controlled by the `view`
 * preset query parameter (e.g. `?view=player`) and/or an explicit `panels`
 * list (e.g. `?panels=viewer,filmstrip`).
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

export const VIEWER_VIEWS = {
	/** Every panel */
	full: VIEWER_PANEL_IDS,
	/** Screenshot viewer with a ruler and filmstrip to scrub through the test */
	player: ["viewer", "ruler", "filmstrip"],
	/** Everything except the screenshot viewer: header, timelines, filmstrip and details */
	spans: [
		"header",
		"ruler",
		"filmstrip",
		"steps",
		"browser",
		"external",
		"details",
	],
} as const satisfies Record<string, readonly ViewerPanelId[]>;

export type ViewerViewId = keyof typeof VIEWER_VIEWS;

export const VIEWER_VIEW_QUERY_PARAM_NAME = "view";
export const VIEWER_PANELS_QUERY_PARAM_NAME = "panels";

export const ALL_VIEWER_PANELS: ViewerPanels = Object.freeze(
	panelsFromIds(VIEWER_PANEL_IDS),
);

function panelsFromIds(ids: readonly ViewerPanelId[]): ViewerPanels {
	return Object.fromEntries(
		VIEWER_PANEL_IDS.map((id) => [id, ids.includes(id)]),
	) as ViewerPanels;
}

function isViewerPanelId(value: string): value is ViewerPanelId {
	return (VIEWER_PANEL_IDS as readonly string[]).includes(value);
}

function isViewerViewId(value: string): value is ViewerViewId {
	return Object.hasOwn(VIEWER_VIEWS, value);
}

function parsePanelList(value: string | null): ViewerPanelId[] {
	if (value === null) return [];
	return value
		.split(",")
		.map((part) => part.trim().toLowerCase())
		.filter(isViewerPanelId);
}

/**
 * Resolves the shown panels from the query parameters:
 *
 * 1. `panels`, a comma-separated list of panel names, wins when it contains
 *    any recognised name. Unknown names are ignored.
 * 2. Otherwise `view` selects a preset (`full`, `player`, `spans`).
 * 3. Otherwise every panel is shown, so a typo never results in an empty
 *    viewer.
 */
export function parseViewerPanels(params: URLSearchParams): ViewerPanels {
	const panelIds = parsePanelList(params.get(VIEWER_PANELS_QUERY_PARAM_NAME));
	if (panelIds.length > 0) return panelsFromIds(panelIds);

	const view = params.get(VIEWER_VIEW_QUERY_PARAM_NAME)?.trim().toLowerCase();
	if (view && isViewerViewId(view)) return panelsFromIds(VIEWER_VIEWS[view]);

	return ALL_VIEWER_PANELS;
}

export function readViewerPanelsFromQueryParams(): ViewerPanels {
	if (typeof window === "undefined") return ALL_VIEWER_PANELS;
	return parseViewerPanels(new URLSearchParams(window.location.search));
}
