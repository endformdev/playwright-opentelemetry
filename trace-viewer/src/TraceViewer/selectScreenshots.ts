/**
 * Screenshot selection utilities for the filmstrip component.
 * Extracted for better testability.
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
 * Selects screenshots to fill N slots, prioritizing those within the given time range.
 * When no screenshots are within the range, selects the closest ones to the range.
 * Distributes selection points evenly across the range and finds the closest screenshot to each point.
 *
 * When there are fewer screenshots than slots, screenshots will be repeated to fill all slots evenly.
 *
 * @param screenshots - Array of screenshots with timestamp property
 * @param slotCount - Number of slots to fill
 * @param timeRange - Optional time range to prioritize (e.g., visible viewport). If not provided, uses full screenshot range.
 * @returns Array of selected screenshots (may contain duplicates when fewer than slots)
 */
export function selectScreenshots<T extends Screenshot>(
	screenshots: T[],
	slotCount: number,
	timeRange?: TimeRange,
): T[] {
	if (screenshots.length === 0 || slotCount <= 0) return [];

	// Sort screenshots by timestamp
	const sorted = [...screenshots].sort((a, b) => a.timestamp - b.timestamp);

	// If no time range specified, use the full range of screenshots
	if (!timeRange) {
		return selectFromRange(sorted, slotCount, {
			startMs: sorted[0].timestamp,
			endMs: sorted[sorted.length - 1].timestamp,
		});
	}

	// Find screenshots within the time range
	const inRange = sorted.filter(
		(s) => s.timestamp >= timeRange.startMs && s.timestamp <= timeRange.endMs,
	);

	if (inRange.length > 0) {
		// We have screenshots in range - select from them
		return selectFromRange(inRange, slotCount, timeRange);
	}

	// No screenshots in range - find closest ones to the range
	return selectClosestToRange(sorted, slotCount, timeRange);
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
 * Selects screenshots from within a range, distributing evenly across the range.
 *
 * @param sortedScreenshots - Screenshots sorted by timestamp (all within or relevant to the range)
 * @param slotCount - Number of slots to fill
 * @param range - The time range to distribute selection points across
 * @returns Array of selected screenshots
 */
function selectFromRange<T extends Screenshot>(
	sortedScreenshots: T[],
	slotCount: number,
	range: TimeRange,
): T[] {
	if (sortedScreenshots.length === 0) return [];

	// When we have fewer or equal screenshots than slots, fill with repeats
	if (sortedScreenshots.length <= slotCount) {
		return fillSlotsWithRepeats(sortedScreenshots, slotCount);
	}

	// More screenshots than slots - select evenly distributed ones across the range
	return selectEvenlyDistributed(sortedScreenshots, slotCount, range);
}

/**
 * Selects the closest screenshots to a range when none are within it.
 * This handles the case of zooming into a time period with no screenshots -
 * we show the closest screenshots (before and/or after the visible range).
 *
 * @param sortedScreenshots - All screenshots sorted by timestamp
 * @param slotCount - Number of slots to fill
 * @param range - The time range (which has no screenshots in it)
 * @returns Array of closest screenshots, repeated to fill slots
 */
function selectClosestToRange<T extends Screenshot>(
	sortedScreenshots: T[],
	slotCount: number,
	range: TimeRange,
): T[] {
	// Find the closest screenshots before and after the range
	let closestBefore: T | null = null;
	let closestAfter: T | null = null;

	for (const screenshot of sortedScreenshots) {
		if (screenshot.timestamp < range.startMs) {
			// Before range - keep the closest one
			if (!closestBefore || screenshot.timestamp > closestBefore.timestamp) {
				closestBefore = screenshot;
			}
		} else if (screenshot.timestamp > range.endMs) {
			// After range - keep the closest one
			if (!closestAfter || screenshot.timestamp < closestAfter.timestamp) {
				closestAfter = screenshot;
			}
		}
	}

	// Determine which screenshots to use based on what we found
	const candidates: T[] = [];

	if (closestBefore && closestAfter) {
		// We have screenshots on both sides - use both
		const distBefore = range.startMs - closestBefore.timestamp;
		const distAfter = closestAfter.timestamp - range.endMs;

		// Add them in order, with the closer one potentially appearing more
		if (distBefore <= distAfter) {
			candidates.push(closestBefore, closestAfter);
		} else {
			candidates.push(closestAfter, closestBefore);
		}
	} else if (closestBefore) {
		candidates.push(closestBefore);
	} else if (closestAfter) {
		candidates.push(closestAfter);
	}

	if (candidates.length === 0) {
		// Fallback: shouldn't happen if sortedScreenshots is non-empty
		return [];
	}

	// Fill slots with the candidates
	return fillSlotsWithRepeats(candidates, slotCount);
}

/**
 * Fills N slots with screenshots, repeating them evenly when needed.
 * Each screenshot gets roughly equal representation.
 *
 * @param sortedScreenshots - Screenshots sorted by timestamp
 * @param slotCount - Number of slots to fill
 * @returns Array of screenshots filling all slots
 */
function fillSlotsWithRepeats<T extends Screenshot>(
	sortedScreenshots: T[],
	slotCount: number,
): T[] {
	if (sortedScreenshots.length === 0) return [];
	if (sortedScreenshots.length === 1) {
		// Single screenshot fills all slots
		return Array(slotCount).fill(sortedScreenshots[0]);
	}

	const result: T[] = [];
	const screenshotCount = sortedScreenshots.length;

	// Map each slot to a screenshot index
	// Distribute slots evenly across the available screenshots
	for (let slot = 0; slot < slotCount; slot++) {
		// Calculate which screenshot this slot should show
		// Map slot position [0, slotCount-1] to screenshot index [0, screenshotCount-1]
		const progress = slot / (slotCount - 1);
		const screenshotIndex = Math.round(progress * (screenshotCount - 1));
		result.push(sortedScreenshots[screenshotIndex]);
	}

	return result;
}

/**
 * Selects N evenly distributed screenshots from a larger set.
 * Distribution is based on the given time range, not just the screenshot timestamps.
 *
 * @param sortedScreenshots - Screenshots sorted by timestamp
 * @param count - Number of screenshots to select
 * @param range - Time range to distribute selection points across
 * @returns Array of selected screenshots
 */
function selectEvenlyDistributed<T extends Screenshot>(
	sortedScreenshots: T[],
	count: number,
	range: TimeRange,
): T[] {
	const timeSpan = range.endMs - range.startMs;

	// If range has no width, just take first N
	if (timeSpan <= 0) return sortedScreenshots.slice(0, count);

	// Calculate evenly distributed target timestamps across the range
	const targetTimestamps: number[] = [];
	for (let i = 0; i < count; i++) {
		// Distribute points evenly from start to end of range
		const progress = count === 1 ? 0.5 : i / (count - 1);
		targetTimestamps.push(range.startMs + timeSpan * progress);
	}

	// For each target timestamp, find the closest unused screenshot
	const selectedScreenshots: T[] = [];
	const usedIndices = new Set<number>();

	for (const targetTime of targetTimestamps) {
		let closestIndex = 0;
		let closestDistance = Number.POSITIVE_INFINITY;

		for (let i = 0; i < sortedScreenshots.length; i++) {
			if (usedIndices.has(i)) continue;

			const distance = Math.abs(sortedScreenshots[i].timestamp - targetTime);
			if (distance < closestDistance) {
				closestDistance = distance;
				closestIndex = i;
			}
		}

		usedIndices.add(closestIndex);
		selectedScreenshots.push(sortedScreenshots[closestIndex]);
	}

	return selectedScreenshots;
}
