/** How the big screen lays out a trace's screenshot and the comparison's. */
export type ComparisonLayout = "side-by-side" | "stacked";

export interface ComparisonArea {
	/** The screen area's size, in pixels */
	widthPx: number;
	heightPx: number;
	/** The screenshots' width over their height */
	aspect: number;
	/** Height of the caption over each screenshot */
	captionPx: number;
	/** Space between the two figures */
	gapPx: number;
	/**
	 * The comparison's screenshot size over the primary's, so the primary
	 * reads as the main one
	 */
	comparisonScale: number;
}

export interface ScreenshotSize {
	widthPx: number;
	heightPx: number;
}

export interface ComparisonLayoutChoice {
	layout: ComparisonLayout;
	/** The size each screenshot is shown at, which its caption spans */
	primary: ScreenshotSize;
	comparison: ScreenshotSize;
}

/**
 * Side by side, unless stacking the two makes the screenshots larger, as in a
 * player embedded in a narrow column. Both are shown whole, the comparison
 * scaled down from the primary, so the larger layout is the one where the
 * primary gets more height.
 */
export function layOutComparison(area: ComparisonArea): ComparisonLayoutChoice {
	const { widthPx, heightPx, aspect, captionPx, gapPx, comparisonScale } = area;
	const sideBySideHeight = Math.min(
		(widthPx - gapPx) / (1 + comparisonScale) / aspect,
		heightPx - captionPx,
	);
	const stackedHeight = Math.min(
		widthPx / aspect,
		(heightPx - gapPx - 2 * captionPx) / (1 + comparisonScale),
	);
	const stacked = stackedHeight > sideBySideHeight;
	const primaryHeightPx = Math.max(
		0,
		stacked ? stackedHeight : sideBySideHeight,
	);
	const comparisonHeightPx = primaryHeightPx * comparisonScale;
	return {
		layout: stacked ? "stacked" : "side-by-side",
		primary: { widthPx: primaryHeightPx * aspect, heightPx: primaryHeightPx },
		comparison: {
			widthPx: comparisonHeightPx * aspect,
			heightPx: comparisonHeightPx,
		},
	};
}
