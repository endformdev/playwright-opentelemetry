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
 * Each thumbnail shows the most recent screenshot at or before the slot's start.
 * If no screenshot exists yet, the slot is empty. Frames captured later within
 * the slot become visible only in subsequent thumbnails (or while hovering).
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

	const slotWidth = Math.max(0, range.endMs - range.startMs) / slotCount;
	const result: SlotScreenshot<T>[] = [];
	let nextIndex = 0;
	let current: T | null = null;
	for (let index = 0; index < slotCount; index++) {
		const slotStartMs = range.startMs + index * slotWidth;
		while (
			nextIndex < sorted.length &&
			sorted[nextIndex].timestamp <= slotStartMs
		) {
			current = sorted[nextIndex++];
		}
		result.push(current);
	}
	return result;
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
