/**
 * Timeline scale calculation utilities for the timeline ruler component.
 * Extracted for better testability.
 */

/**
 * A single tick mark on the timeline
 */
export interface TimelineTick {
	/** Position as a fraction (0 to 1) along the timeline */
	position: number;
	/** Time in milliseconds from the start */
	timeMs: number;
	/** Human-readable label for this tick (e.g., "0s", "1.5s", "2m") */
	label: string;
}

/**
 * The calculated timeline scale with tick marks
 */
export interface TimelineScale {
	/** The time interval between each tick mark in milliseconds */
	intervalMs: number;
	/** Array of tick marks with position and label */
	ticks: TimelineTick[];
}

/**
 * "Nice" intervals to choose from, in milliseconds.
 * These are round numbers that make sense for time display.
 */
const NICE_INTERVALS_MS = [
	100, // 100ms
	200, // 200ms
	250, // 250ms
	500, // 500ms
	1000, // 1s
	2000, // 2s
	5000, // 5s
	10000, // 10s
	15000, // 15s
	30000, // 30s
	60000, // 1m
	120000, // 2m
	300000, // 5m
	600000, // 10m
];

/**
 * Formats a time in milliseconds to a human-readable label.
 *
 * @param timeMs - Time in milliseconds
 * @returns Formatted string (e.g., "0s", "1.5s", "2m", "1m 30s")
 */
export function formatTimeLabel(timeMs: number): string {
	if (timeMs === 0) return "0s";

	const totalSeconds = timeMs / 1000;

	// For times under 1 second, show milliseconds
	if (totalSeconds < 1) {
		return `${Math.round(timeMs)}ms`;
	}

	// For times under 1 minute
	if (totalSeconds < 60) {
		// Show decimal only if needed and if it's a nice value
		if (totalSeconds === Math.floor(totalSeconds)) {
			return `${totalSeconds}s`;
		}
		// Round to 1 decimal place for cleaner display
		const rounded = Math.round(totalSeconds * 10) / 10;
		if (rounded === Math.floor(rounded)) {
			return `${rounded}s`;
		}
		return `${rounded}s`;
	}

	// For times 1 minute and above
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = Math.round(totalSeconds % 60);

	if (seconds === 0) {
		return `${minutes}m`;
	}
	return `${minutes}m ${seconds}s`;
}

/**
 * Calculates the optimal number of ticks that can fit in the given width.
 *
 * @param availableWidth - The width in pixels available for the timeline
 * @param minTickSpacing - Minimum pixels between tick marks (default: 60)
 * @returns Maximum number of ticks that can fit (minimum 2 for start/end)
 */
export function calculateMaxTicks(
	availableWidth: number,
	minTickSpacing = 60,
): number {
	if (availableWidth <= 0) return 0;

	// We need space for N ticks, which means N-1 intervals
	// Each interval needs at least minTickSpacing pixels
	// So: (N-1) * minTickSpacing <= availableWidth
	// N <= (availableWidth / minTickSpacing) + 1
	const maxTicks = Math.floor(availableWidth / minTickSpacing) + 1;

	// Ensure we have at least 2 ticks (start and end) if there's any space
	return Math.max(2, maxTicks);
}

/**
 * Selects the best "nice" interval for the given duration and max tick count.
 *
 * @param durationMs - Total duration in milliseconds
 * @param maxTicks - Maximum number of ticks that can fit
 * @returns The selected interval in milliseconds
 */
export function selectNiceInterval(
	durationMs: number,
	maxTicks: number,
): number {
	if (durationMs <= 0 || maxTicks < 2) {
		return durationMs > 0 ? durationMs : 1000;
	}

	// We want the smallest interval that doesn't exceed maxTicks
	// Number of ticks for a given interval = floor(duration / interval) + 1
	for (const interval of NICE_INTERVALS_MS) {
		const tickCount = Math.floor(durationMs / interval) + 1;
		if (tickCount <= maxTicks) {
			return interval;
		}
	}

	// If no nice interval works, calculate a custom one
	// We want maxTicks ticks, so interval = duration / (maxTicks - 1)
	const customInterval = durationMs / (maxTicks - 1);

	// Round up to a reasonable value
	const magnitude = 10 ** Math.floor(Math.log10(customInterval));
	return Math.ceil(customInterval / magnitude) * magnitude;
}

/**
 * Generates tick marks for the timeline based on duration and interval.
 *
 * @param durationMs - Total duration in milliseconds
 * @param intervalMs - Interval between ticks in milliseconds
 * @returns Array of tick marks
 */
export function generateTicks(
	durationMs: number,
	intervalMs: number,
): TimelineTick[] {
	if (durationMs <= 0) {
		return [{ position: 0, timeMs: 0, label: "0s" }];
	}

	const ticks: TimelineTick[] = [];

	// Generate ticks at regular intervals starting from 0
	for (let timeMs = 0; timeMs <= durationMs; timeMs += intervalMs) {
		ticks.push({
			position: timeMs / durationMs,
			timeMs,
			label: formatTimeLabel(timeMs),
		});
	}

	// Always include the end tick if it's not already there
	const lastTick = ticks[ticks.length - 1];
	if (lastTick && lastTick.timeMs < durationMs) {
		const distanceFromLast = durationMs - lastTick.timeMs;

		// If the last regular tick is very close to the end (within 50% of interval),
		// replace it with the end tick to avoid overlap
		if (distanceFromLast <= intervalMs * 0.5) {
			ticks.pop();
		}

		// Add the end tick
		ticks.push({
			position: 1,
			timeMs: durationMs,
			label: formatTimeLabel(durationMs),
		});
	}

	return ticks;
}

/**
 * Calculates the optimal timeline scale for displaying time divisions.
 *
 * This function determines:
 * 1. How many ticks can fit based on available width
 * 2. What "nice" interval to use (1s, 5s, 10s, etc.)
 * 3. The position and label for each tick
 *
 * @param durationMs - Total duration in milliseconds
 * @param availableWidth - Available width in pixels for the timeline
 * @param minTickSpacing - Minimum pixels between tick marks (default: 60)
 * @returns TimelineScale with interval and tick marks
 *
 * @example
 * // 10 second test, 500px width
 * calculateTimelineScale(10000, 500)
 * // Returns ticks at 0s, 1s, 2s, ..., 10s (1 second interval)
 *
 * @example
 * // 2 minute test, 300px width
 * calculateTimelineScale(120000, 300)
 * // Returns ticks at 0s, 30s, 1m, 1m 30s, 2m (30 second interval)
 */
export function calculateTimelineScale(
	durationMs: number,
	availableWidth: number,
	minTickSpacing = 60,
): TimelineScale {
	const maxTicks = calculateMaxTicks(availableWidth, minTickSpacing);
	const intervalMs = selectNiceInterval(durationMs, maxTicks);
	const ticks = generateTicks(durationMs, intervalMs);

	return {
		intervalMs,
		ticks,
	};
}
