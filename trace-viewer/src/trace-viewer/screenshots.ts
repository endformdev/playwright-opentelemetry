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
