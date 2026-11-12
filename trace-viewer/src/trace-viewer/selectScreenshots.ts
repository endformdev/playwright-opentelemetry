import { SCREENSHOT_LAG_MS } from "./screenshots";

/**
 * Screenshot selection for the filmstrips.
 *
 * The core principle is causality: each slot in a filmstrip represents a time range,
 * and we only show screenshots of the page as it was at that time. A frame
 * stamped up to SCREENSHOT_LAG_MS later still shows it, as in the big view.
 */

export interface Screenshot {
	timestamp: number;
}

/** The times a filmstrip spreads its slots across. */
export interface TimeRange {
	startMs: number;
	endMs: number;
}

/**
 * Selects screenshots to fill N slots based on time boundaries.
 *
 * Each slot represents a specific time range within the overall timeRange.
 * Each thumbnail shows the frame at the slot's start, as findScreenshotAtTime
 * picks it: the latest one taken by SCREENSHOT_LAG_MS after the start.
 * If no screenshot exists yet, the slot is empty (null). Frames captured later
 * within the slot become visible only in subsequent thumbnails (or while hovering).
 *
 * @param screenshots - Array of screenshots with timestamp property
 * @param slotCount - Number of slots to fill
 * @param timeRange - Time range to distribute slots across, in the screenshots' clock
 * @returns Array of selected screenshots (may contain nulls for empty slots)
 */
export function selectScreenshots<T extends Screenshot>(
	screenshots: T[],
	slotCount: number,
	timeRange: TimeRange,
): (T | null)[] {
	if (slotCount <= 0) return [];

	const sorted = [...screenshots].sort((a, b) => a.timestamp - b.timestamp);
	const slotWidth =
		Math.max(0, timeRange.endMs - timeRange.startMs) / slotCount;
	const result: (T | null)[] = [];
	let nextIndex = 0;
	let current: T | null = null;
	for (let index = 0; index < slotCount; index++) {
		const slotStartMs = timeRange.startMs + index * slotWidth;
		while (
			nextIndex < sorted.length &&
			sorted[nextIndex].timestamp <= slotStartMs + SCREENSHOT_LAG_MS
		) {
			current = sorted[nextIndex++];
		}
		result.push(current);
	}
	return result;
}
