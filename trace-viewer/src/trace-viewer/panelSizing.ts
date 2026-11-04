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
