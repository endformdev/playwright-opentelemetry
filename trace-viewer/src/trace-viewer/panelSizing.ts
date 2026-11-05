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

/** Step viewer height above the span panels, showing the big screen */
export const PLAYER_BIG_SCREEN_SIZE_PERCENT = 45;
export const MIN_PLAYER_SIZE_PERCENT = 20;

/** The control bar and step ruler under the player's screen */
const PLAYER_CONTROLS_HEIGHT_PX = 100;
export const FILMSTRIP_SCREEN_PADDING_Y_PX = 12;
export const FILMSTRIP_SCREEN_ROW_GAP_PX = 8;

/** Rows start shorter as pages are added, as they share the space */
function getFilmstripScreenRowHeightPx(rowCount: number): number {
	if (rowCount <= 1) return 140;
	if (rowCount === 2) return 100;
	return 72;
}

/**
 * The step viewer's height showing the filmstrip, in percent of the column
 * it shares with the span panels: enough for a row per page, which leaves
 * more room for the spans. It never takes more than the big screen would.
 */
export function getPlayerFilmstripSizePercent(
	pageCount: number,
	columnHeightPx: number,
): number {
	if (columnHeightPx <= 0) return PLAYER_BIG_SCREEN_SIZE_PERCENT;
	const rowCount = Math.max(1, pageCount);
	const heightPx =
		PLAYER_CONTROLS_HEIGHT_PX +
		2 * FILMSTRIP_SCREEN_PADDING_Y_PX +
		rowCount * getFilmstripScreenRowHeightPx(rowCount) +
		(rowCount - 1) * FILMSTRIP_SCREEN_ROW_GAP_PX;
	return Math.max(
		MIN_PLAYER_SIZE_PERCENT,
		Math.min(PLAYER_BIG_SCREEN_SIZE_PERCENT, (heightPx / columnHeightPx) * 100),
	);
}
