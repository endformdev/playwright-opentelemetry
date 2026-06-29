import type { ScreenshotInfo } from "../trace-info-loader";

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

export function isSameScreenshotPage(
	first: ScreenshotInfo,
	second: ScreenshotInfo,
): boolean {
	return first.contextId === second.contextId && first.pageId === second.pageId;
}
