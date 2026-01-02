const MIN_ROWS = 8;

const ROW_HEIGHT = 28;

export interface PanelDepthInfo {
	stepsDepth: number;
	browserDepth: number;
	externalDepth: number;
}

export interface ActivePanelSizes {
	steps?: number;
	browser?: number;
	external?: number;
}

export function calculateDepthBasedSizes(
	depths: PanelDepthInfo,
): ActivePanelSizes {
	const activePanels: Array<{ key: keyof ActivePanelSizes; depth: number }> =
		[];

	if (depths.stepsDepth > 0) {
		activePanels.push({ key: "steps", depth: depths.stepsDepth });
	}
	if (depths.browserDepth > 0) {
		activePanels.push({ key: "browser", depth: depths.browserDepth });
	}
	if (depths.externalDepth > 0) {
		activePanels.push({ key: "external", depth: depths.externalDepth });
	}

	// No active panels
	if (activePanels.length === 0) {
		return {};
	}

	// Single panel gets 100%
	if (activePanels.length === 1) {
		return { [activePanels[0].key]: 100 };
	}

	// Multiple panels: distribute based on depth
	// Each panel gets MIN_ROWS as baseline, then extra based on depth beyond minimum
	const effectiveDepths = activePanels.map((p) => ({
		...p,
		// Effective depth is at least MIN_ROWS, used for proportional calculation
		effectiveDepth: Math.max(p.depth, MIN_ROWS),
	}));

	const totalEffectiveDepth = effectiveDepths.reduce(
		(sum, p) => sum + p.effectiveDepth,
		0,
	);

	const result: ActivePanelSizes = {};

	for (const panel of effectiveDepths) {
		const percentage = (panel.effectiveDepth / totalEffectiveDepth) * 100;
		result[panel.key] = percentage;
	}

	return result;
}

export function getSizesForActivePanels(
	depths: PanelDepthInfo,
): Array<{ id: string; size: number; minSize: number }> {
	const sizes = calculateDepthBasedSizes(depths);
	const result: Array<{ id: string; size: number; minSize: number }> = [];

	// Order matters: steps, browser, external
	if (sizes.steps !== undefined) {
		result.push({
			id: "steps",
			size: sizes.steps,
			minSize: calculateMinSizePercent(depths, "steps"),
		});
	}
	if (sizes.browser !== undefined) {
		result.push({
			id: "browser",
			size: sizes.browser,
			minSize: calculateMinSizePercent(depths, "browser"),
		});
	}
	if (sizes.external !== undefined) {
		result.push({
			id: "external",
			size: sizes.external,
			minSize: calculateMinSizePercent(depths, "external"),
		});
	}

	return result;
}

function calculateMinSizePercent(
	depths: PanelDepthInfo,
	_panelId: string,
): number {
	// Count active panels
	let activeCount = 0;
	if (depths.stepsDepth > 0) activeCount++;
	if (depths.browserDepth > 0) activeCount++;
	if (depths.externalDepth > 0) activeCount++;

	if (activeCount === 0) return 0;

	// Minimum is roughly MIN_ROWS worth, but expressed as percentage
	// Assuming roughly equal distribution as baseline
	return Math.max(10, 100 / (activeCount * 2));
}

export function isPanelActive(depth: number): boolean {
	return depth > 0;
}

export function getIdealPanelHeight(depth: number): number {
	return Math.max(depth, MIN_ROWS) * ROW_HEIGHT;
}
