/**
 * Lets the page embedding the viewer in an iframe add a button to the end of
 * the player's control bar, with the `action` query parameter (e.g.
 * `?action=expand`). Clicking it posts a message to the embedding page, which
 * decides what the action does, e.g. open a modal with the `full` view. The
 * viewer does nothing itself, so the button only appears when there is a
 * parent page to hear it.
 */

export const VIEWER_ACTION_IDS = [
	/** Show the trace somewhere bigger */
	"expand",
] as const;

export type ViewerActionId = (typeof VIEWER_ACTION_IDS)[number];

export const VIEWER_ACTION_QUERY_PARAM_NAME = "action";

/** `data.type` of the message posted to the embedding page */
export const VIEWER_ACTION_MESSAGE_TYPE = "trace-viewer:action";

export interface ViewerAction {
	id: ViewerActionId;
	run: () => void;
}

function isViewerActionId(value: string): value is ViewerActionId {
	return (VIEWER_ACTION_IDS as readonly string[]).includes(value);
}

/** The action named by the query parameters; unknown names are ignored. */
export function parseViewerActionId(
	params: URLSearchParams,
): ViewerActionId | null {
	const value = params.get(VIEWER_ACTION_QUERY_PARAM_NAME);
	const id = value?.trim().toLowerCase();
	return id && isViewerActionId(id) ? id : null;
}

export function readViewerActionFromQueryParams(): ViewerAction | null {
	if (typeof window === "undefined" || window.parent === window) return null;
	const id = parseViewerActionId(new URLSearchParams(window.location.search));
	if (!id) return null;
	// Any origin may embed the viewer, and the message says nothing about the
	// trace, so it isn't addressed to one. The receiver checks who sent it.
	return {
		id,
		run: () =>
			window.parent.postMessage(
				{ type: VIEWER_ACTION_MESSAGE_TYPE, action: id },
				"*",
			),
	};
}
