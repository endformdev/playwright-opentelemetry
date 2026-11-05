import type { ScreenshotInfo } from "../trace-info-loader";

/** A page (tab or window) and the screenshots it took, in time order. */
export interface ScreenshotPage {
	pageId: string;
	/** 1-based, in the order pages first took a screenshot */
	number: number;
	screenshots: ScreenshotInfo[];
}

export function groupScreenshotsByPage(
	screenshots: ScreenshotInfo[],
): ScreenshotPage[] {
	const byPage = new Map<string, ScreenshotInfo[]>();
	const sorted = [...screenshots].sort((a, b) => a.timestamp - b.timestamp);
	for (const screenshot of sorted) {
		const page = byPage.get(screenshot.pageId);
		if (page) page.push(screenshot);
		else byPage.set(screenshot.pageId, [screenshot]);
	}
	return [...byPage.entries()].map(([pageId, pageScreenshots], index) => ({
		pageId,
		number: index + 1,
		screenshots: pageScreenshots,
	}));
}

export function findScreenshotAtTime(
	screenshots: ScreenshotInfo[],
	absoluteTimeMs: number,
): ScreenshotInfo | null {
	let bestScreenshot: ScreenshotInfo | null = null;
	for (const screenshot of screenshots) {
		if (
			screenshot.timestamp <= absoluteTimeMs &&
			(!bestScreenshot || screenshot.timestamp > bestScreenshot.timestamp)
		) {
			bestScreenshot = screenshot;
		}
	}
	return bestScreenshot;
}

/** How far a colour channel may stray from the first pixel's, out of 255 */
const BLANK_CHANNEL_TOLERANCE = 8;

/**
 * Whether RGBA pixels are all one colour, like a page with nothing painted on
 * it yet. The tolerance absorbs compression noise, not faint content: the
 * pixels aren't scaled down, so even a little text stands out.
 */
export function isBlankPixels(rgba: Uint8ClampedArray): boolean {
	for (let index = 4; index < rgba.length; index++) {
		const difference = Math.abs(rgba[index] - rgba[index % 4]);
		if (difference > BLANK_CHANNEL_TOLERANCE) return false;
	}
	return true;
}

/** An image that can't be read counts as not blank, so it just gets shown. */
async function isBlankImage(url: string): Promise<boolean> {
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = image.naturalWidth;
		canvas.height = image.naturalHeight;
		const context = canvas.getContext("2d", { willReadFrequently: true });
		if (!context) return false;
		context.drawImage(image, 0, 0);
		const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
		return isBlankPixels(data);
	} catch {
		return false;
	}
}

/**
 * The earliest screenshot with something on it, or the earliest of all when
 * they're all blank. Tests usually start on a blank page, and traces don't say
 * which frames are blank, so this looks at the frames in turn.
 */
export async function findFirstContentfulScreenshot(
	screenshots: ScreenshotInfo[],
	isBlank: (url: string) => Promise<boolean> = isBlankImage,
): Promise<ScreenshotInfo | null> {
	const sorted = [...screenshots].sort((a, b) => a.timestamp - b.timestamp);
	for (const screenshot of sorted) {
		if (!(await isBlank(screenshot.url))) return screenshot;
	}
	return sorted[0] ?? null;
}
