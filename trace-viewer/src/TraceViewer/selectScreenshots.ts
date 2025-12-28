/**
 * Screenshot selection utilities for the filmstrip component.
 * Extracted for better testability.
 */

export interface Screenshot {
	timestamp: number;
}

/**
 * Selects screenshots to fill N slots from the available set.
 * Distributes selection points evenly across the timeline and finds the closest
 * screenshot to each point.
 *
 * When there are fewer screenshots than slots, screenshots will be repeated
 * to fill all slots evenly.
 *
 * @param screenshots - Array of screenshots with timestamp property
 * @param slotCount - Number of slots to fill
 * @returns Array of selected screenshots (may contain duplicates when fewer than slots)
 */
export function selectScreenshots<T extends Screenshot>(
	screenshots: T[],
	slotCount: number,
): T[] {
	if (screenshots.length === 0 || slotCount <= 0) return [];

	// Sort screenshots by timestamp
	const sorted = [...screenshots].sort((a, b) => a.timestamp - b.timestamp);

	// When we have fewer or equal screenshots than slots, fill with repeats
	if (sorted.length <= slotCount) {
		return fillSlotsWithRepeats(sorted, slotCount);
	}

	// More screenshots than slots - select evenly distributed ones
	return selectEvenlyDistributed(sorted, slotCount);
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
 * Each screenshot is used at most once.
 *
 * @param sortedScreenshots - Screenshots sorted by timestamp
 * @param count - Number of screenshots to select
 * @returns Array of selected screenshots
 */
function selectEvenlyDistributed<T extends Screenshot>(
	sortedScreenshots: T[],
	count: number,
): T[] {
	const minTime = sortedScreenshots[0].timestamp;
	const maxTime = sortedScreenshots[sortedScreenshots.length - 1].timestamp;
	const timeRange = maxTime - minTime;

	// If all screenshots have the same timestamp, just return the first N
	if (timeRange === 0) return sortedScreenshots.slice(0, count);

	// Calculate evenly distributed target timestamps
	const targetTimestamps: number[] = [];
	for (let i = 0; i < count; i++) {
		// Distribute points evenly from min to max
		const progress = count === 1 ? 0.5 : i / (count - 1);
		targetTimestamps.push(minTime + timeRange * progress);
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
