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
}

export interface ComparisonLayoutChoice {
	layout: ComparisonLayout;
	/** The size each screenshot is shown at, which its caption spans */
	imageWidthPx: number;
	imageHeightPx: number;
}

/**
 * Side by side, unless stacking the two makes the screenshots larger, as in a
 * player embedded in a narrow column. Both are shown whole, so the larger
 * layout is the one where each screenshot gets more height.
 */
export function layOutComparison(area: ComparisonArea): ComparisonLayoutChoice {
	const { widthPx, heightPx, aspect, captionPx, gapPx } = area;
	const sideBySideHeight = Math.min(
		(widthPx - gapPx) / 2 / aspect,
		heightPx - captionPx,
	);
	const stackedHeight = Math.min(
		widthPx / aspect,
		(heightPx - gapPx) / 2 - captionPx,
	);
	const stacked = stackedHeight > sideBySideHeight;
	const imageHeightPx = Math.max(0, stacked ? stackedHeight : sideBySideHeight);
	return {
		layout: stacked ? "stacked" : "side-by-side",
		imageWidthPx: imageHeightPx * aspect,
		imageHeightPx,
	};
}
