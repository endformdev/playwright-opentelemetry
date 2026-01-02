/**
 * Screenshot selection utilities for the filmstrip component.
 * Extracted for better testability.
 *
 * The core principle is causality: each slot in the filmstrip represents a time range,
 * and we only show screenshots that existed at that time (never future screenshots).
 */

import type { TimelineViewport } from "./viewport";

export interface Screenshot {
	timestamp: number;
}

/**
 * Represents a time range for selecting screenshots.
 * Used to specify the visible viewport range.
 */
export interface TimeRange {
	startMs: number;
	endMs: number;
}

/**
 * Result of screenshot selection for a single slot.
 * null means no screenshot is available for this slot (show empty).
 */
export type SlotScreenshot<T> = T | null;

/**
 * Selects screenshots to fill N slots based on time boundaries.
 *
 * Each slot represents a specific time range within the overall timeRange.
 * For each slot, we select:
 * 1. If there are screenshots within the slot's time bounds: the one closest to center
 * 2. If no screenshots in bounds: the most recent screenshot BEFORE this slot
 * 3. If no earlier screenshots exist: null (empty slot)
 *
 * This respects causality - we never show a screenshot before its timestamp.
 *
 * @param screenshots - Array of screenshots with timestamp property
 * @param slotCount - Number of slots to fill
 * @param timeRange - Time range to distribute slots across (e.g., visible viewport)
 * @returns Array of selected screenshots (may contain nulls for empty slots)
 */
export function selectScreenshots<T extends Screenshot>(
	screenshots: T[],
	slotCount: number,
	timeRange?: TimeRange,
): SlotScreenshot<T>[] {
	if (slotCount <= 0) return [];
	if (screenshots.length === 0) return Array(slotCount).fill(null);

	// Sort screenshots by timestamp
	const sorted = [...screenshots].sort((a, b) => a.timestamp - b.timestamp);

	// If no time range specified, use the full range of screenshots
	const range = timeRange ?? {
		startMs: sorted[0].timestamp,
		endMs: sorted[sorted.length - 1].timestamp,
	};

	// Check if we're zoomed into an empty region (no screenshots in range)
	const screenshotsInRange = sorted.filter(
		(s) => s.timestamp >= range.startMs && s.timestamp <= range.endMs,
	);

	if (screenshotsInRange.length === 0) {
		// No screenshots in the visible range - find the closest earlier one
		return selectForEmptyRange(sorted, slotCount, range);
	}

	// Normal case: distribute slots across the range and select for each
	return selectWithSlotBoundaries(sorted, slotCount, range);
}

/**
 * Converts a TimelineViewport to a TimeRange for screenshot selection.
 */
export function viewportToTimeRange(viewport: TimelineViewport): TimeRange {
	return {
		startMs: viewport.visibleStartMs,
		endMs: viewport.visibleEndMs,
	};
}

/**
 * Handles the case when zoomed into a region with no screenshots.
 * Finds the closest screenshot before the range and repeats it for all slots.
 */
function selectForEmptyRange<T extends Screenshot>(
	sortedScreenshots: T[],
	slotCount: number,
	range: TimeRange,
): SlotScreenshot<T>[] {
	// Find the most recent screenshot before the range
	let closestBefore: T | null = null;

	for (const screenshot of sortedScreenshots) {
		if (screenshot.timestamp < range.startMs) {
			if (!closestBefore || screenshot.timestamp > closestBefore.timestamp) {
				closestBefore = screenshot;
			}
		}
	}

	// If no earlier screenshot exists, all slots are empty
	if (!closestBefore) {
		return Array(slotCount).fill(null);
	}

	// Repeat the closest earlier screenshot for all slots
	return Array(slotCount).fill(closestBefore);
}

/**
 * Selects screenshots using slot boundaries.
 * Each slot covers a time range, and we pick the best screenshot for each.
 */
function selectWithSlotBoundaries<T extends Screenshot>(
	sortedScreenshots: T[],
	slotCount: number,
	range: TimeRange,
): SlotScreenshot<T>[] {
	const timeSpan = range.endMs - range.startMs;

	// Handle zero-width range (edge case)
	if (timeSpan <= 0) {
		// All slots cover the same instant - find screenshot at or before that time
		const screenshot = findScreenshotAtOrBefore(
			sortedScreenshots,
			range.startMs,
		);
		return Array(slotCount).fill(screenshot);
	}

	const slotWidth = timeSpan / slotCount;
	const result: SlotScreenshot<T>[] = [];

	for (let i = 0; i < slotCount; i++) {
		const slotStartMs = range.startMs + i * slotWidth;
		const slotEndMs = range.startMs + (i + 1) * slotWidth;
		const slotCenterMs = (slotStartMs + slotEndMs) / 2;

		// Find screenshots within this slot's bounds
		// A screenshot belongs to a slot if: slotStart <= timestamp < slotEnd
		// (exclusive end to avoid double-counting at boundaries)
		// Exception: the last slot uses inclusive end
		const isLastSlot = i === slotCount - 1;
		const screenshotsInSlot = sortedScreenshots.filter((s) =>
			isLastSlot
				? s.timestamp >= slotStartMs && s.timestamp <= slotEndMs
				: s.timestamp >= slotStartMs && s.timestamp < slotEndMs,
		);

		if (screenshotsInSlot.length > 0) {
			// Pick the one closest to the center
			const selected = screenshotsInSlot.reduce((best, current) => {
				const bestDist = Math.abs(best.timestamp - slotCenterMs);
				const currentDist = Math.abs(current.timestamp - slotCenterMs);
				return currentDist < bestDist ? current : best;
			});
			result.push(selected);
		} else {
			// No screenshots in this slot - find the most recent one before this slot
			const screenshot = findScreenshotAtOrBefore(
				sortedScreenshots,
				slotStartMs,
			);
			result.push(screenshot);
		}
	}

	return result;
}

/**
 * Finds the most recent screenshot at or before the given time.
 * Returns null if no such screenshot exists.
 */
function findScreenshotAtOrBefore<T extends Screenshot>(
	sortedScreenshots: T[],
	timeMs: number,
): T | null {
	let best: T | null = null;

	for (const screenshot of sortedScreenshots) {
		if (screenshot.timestamp <= timeMs) {
			if (!best || screenshot.timestamp > best.timestamp) {
				best = screenshot;
			}
		}
	}

	return best;
}
