type SpanPanelId = "steps" | "browser" | "external";

export interface ActiveSpanPanels {
	steps: boolean;
	browser: boolean;
	external: boolean;
}

export interface ActivePanelSizes {
	steps?: number;
	browser?: number;
	external?: number;
}

const PANEL_ORDER: SpanPanelId[] = ["steps", "browser", "external"];

export function calculateInitialPanelSizes(
	panels: ActiveSpanPanels,
): ActivePanelSizes {
	const activePanels = PANEL_ORDER.filter((panel) => panels[panel]);

	if (activePanels.length === 0) {
		return {};
	}

	if (activePanels.length === 1) {
		return { [activePanels[0]]: 100 };
	}

	if (activePanels.length === 3) {
		return { steps: 100 / 3, browser: 100 / 3, external: 100 / 3 };
	}

	if (panels.steps && panels.browser) {
		return { steps: 40, browser: 60 };
	}

	return { [activePanels[0]]: 50, [activePanels[1]]: 50 };
}

/** Step viewer height above a filmstrip of one row (the player layout) */
const STEP_VIEWER_ABOVE_ONE_ROW_PERCENT = 80;
/** Height handed from the step viewer to each further filmstrip row */
const FILMSTRIP_EXTRA_ROW_PERCENT = 8;

/**
 * The step viewer's initial height, in percent, when the timeline below it
 * has no span panels and is just the ruler and filmstrip. The filmstrip
 * stays small for one page but gets a little more room for each further
 * page's row it shows by default, so several screen streams stay readable.
 */
export function getStepViewerAboveFilmstripInitialSize(
	visibleFilmstripRows: number,
): number {
	const extraRows = Math.max(0, visibleFilmstripRows - 1);
	return (
		STEP_VIEWER_ABOVE_ONE_ROW_PERCENT - FILMSTRIP_EXTRA_ROW_PERCENT * extraRows
	);
}
