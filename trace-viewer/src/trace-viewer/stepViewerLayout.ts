/** Matches the screenshot's inset: left-20/right-20 and py-3 */
const SCREENSHOT_GUTTER_PX = 80;
const SCREENSHOT_PADDING_Y_PX = 12;
/** right-3, plus a little air between the caption and the screenshot */
const CAPTION_INSET_PX = 12;
const CAPTION_GAP_PX = 8;
const CAPTION_MIN_WIDTH_PX = 192;
const CAPTION_MAX_WIDTH_PX = 352;

/**
 * Widest the caption can be without covering the screenshot, kept between a
 * readable minimum (it overlaps when there is less room than that) and a
 * maximum past which a single line gets hard to read.
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
		Math.max(CAPTION_MIN_WIDTH_PX, Math.floor(free)),
	);
}
