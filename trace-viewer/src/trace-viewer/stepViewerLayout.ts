/** Matches the screenshot's inset: left-20/right-20 and py-3 */
const SCREENSHOT_GUTTER_PX = 80;
const SCREENSHOT_PADDING_Y_PX = 12;
/** right-3, plus a little air between the caption and the screenshot */
const CAPTION_INSET_PX = 12;
const CAPTION_GAP_PX = 8;
const CAPTION_MIN_WIDTH_PX = 192;
const CAPTION_MAX_WIDTH_PX = 352;
/** The next arrow (h-9) sits centred vertically, under the caption */
const NEXT_ARROW_HALF_HEIGHT_PX = 18;
/**
 * Below this much room between the caption's top and the next arrow, the
 * caption may cover more of the screenshot, widening up to the cramped
 * minimum, so it needs fewer lines.
 */
const CAPTION_ROOMY_HEIGHT_PX = 200;
const CAPTION_CRAMPED_HEIGHT_PX = 80;
const CAPTION_CRAMPED_MIN_WIDTH_PX = 320;

/**
 * Widest the caption can be without covering the screenshot, kept between a
 * readable minimum (it overlaps when there is less room than that) and a
 * maximum past which a single line gets hard to read. The less room the
 * caption has to grow down, the wider that minimum, so in a short viewer it
 * overlaps the screenshot a little more instead of running into the arrow.
 */
export function getCaptionWidthPx(
	viewerWidth: number,
	viewerHeight: number,
	screenshotAspect: number | null,
): number {
	const boxWidth = Math.max(0, viewerWidth - 2 * SCREENSHOT_GUTTER_PX);
	const boxHeight = Math.max(0, viewerHeight - 2 * SCREENSHOT_PADDING_Y_PX);
	const screenshotWidth =
		screenshotAspect === null
			? boxWidth
			: Math.min(boxWidth, boxHeight * screenshotAspect);
	const free =
		SCREENSHOT_GUTTER_PX +
		(boxWidth - screenshotWidth) / 2 -
		CAPTION_INSET_PX -
		CAPTION_GAP_PX;
	return Math.min(
		CAPTION_MAX_WIDTH_PX,
		Math.max(getCaptionMinWidthPx(viewerWidth, viewerHeight), Math.floor(free)),
	);
}

function getCaptionMinWidthPx(
	viewerWidth: number,
	viewerHeight: number,
): number {
	const heightBelowCaption =
		viewerHeight / 2 -
		NEXT_ARROW_HALF_HEIGHT_PX -
		CAPTION_INSET_PX -
		CAPTION_GAP_PX;
	const cramped = Math.min(
		1,
		Math.max(
			0,
			(CAPTION_ROOMY_HEIGHT_PX - heightBelowCaption) /
				(CAPTION_ROOMY_HEIGHT_PX - CAPTION_CRAMPED_HEIGHT_PX),
		),
	);
	const minWidth =
		CAPTION_MIN_WIDTH_PX +
		cramped * (CAPTION_CRAMPED_MIN_WIDTH_PX - CAPTION_MIN_WIDTH_PX);
	// Never let the caption take more than half a narrow viewer for it.
	return Math.floor(
		Math.max(CAPTION_MIN_WIDTH_PX, Math.min(minWidth, viewerWidth / 2)),
	);
}
