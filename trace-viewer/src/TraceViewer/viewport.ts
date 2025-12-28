export interface TimelineViewport {
	/** Start of the visible window in milliseconds */
	visibleStartMs: number;
	/** End of the visible window in milliseconds */
	visibleEndMs: number;
	/** Total duration of the timeline in milliseconds */
	totalDurationMs: number;
}

/** Minimum zoom level (1 = show entire timeline) */
const MIN_ZOOM = 1;
/** Maximum zoom level (e.g., 100 = show 1% of timeline) */
const MAX_ZOOM = 100;
/** Minimum visible duration in ms (to prevent zooming into nothing) */
const MIN_VISIBLE_DURATION_MS = 10;

export function zoomViewport(
	viewport: TimelineViewport,
	focalPosition: number,
	zoomDelta: number,
): TimelineViewport {
	const currentZoom = getZoomLevel(viewport);

	// Calculate new zoom level with smooth scaling
	// Using exponential scaling for more natural feel
	const zoomFactor = 1 + zoomDelta;
	const newZoom = Math.max(
		MIN_ZOOM,
		Math.min(MAX_ZOOM, currentZoom * zoomFactor),
	);

	// Calculate new visible duration
	let newVisibleDuration = viewport.totalDurationMs / newZoom;

	// Ensure minimum visible duration
	newVisibleDuration = Math.max(MIN_VISIBLE_DURATION_MS, newVisibleDuration);

	// Calculate the focal point in absolute time
	const focalTimeMs = viewportPositionToTime(focalPosition, viewport);

	// Calculate new start position, keeping focal point at the same relative position
	const newVisibleStart = focalTimeMs - focalPosition * newVisibleDuration;

	return clampViewport({
		visibleStartMs: newVisibleStart,
		visibleEndMs: newVisibleStart + newVisibleDuration,
		totalDurationMs: viewport.totalDurationMs,
	});
}

export function panViewport(
	viewport: TimelineViewport,
	deltaMs: number,
): TimelineViewport {
	return clampViewport({
		visibleStartMs: viewport.visibleStartMs + deltaMs,
		visibleEndMs: viewport.visibleEndMs + deltaMs,
		totalDurationMs: viewport.totalDurationMs,
	});
}

export function resetViewport(viewport: TimelineViewport): TimelineViewport {
	return createViewport(viewport.totalDurationMs);
}

export function zoomToRange(
	viewport: TimelineViewport,
	startMs: number,
	endMs: number,
	padding = 0.1,
): TimelineViewport {
	const rangeDuration = endMs - startMs;
	const paddingMs = rangeDuration * padding;

	return clampViewport({
		visibleStartMs: startMs - paddingMs,
		visibleEndMs: endMs + paddingMs,
		totalDurationMs: viewport.totalDurationMs,
	});
}

export function createViewport(totalDurationMs: number): TimelineViewport {
	return {
		visibleStartMs: 0,
		visibleEndMs: totalDurationMs,
		totalDurationMs,
	};
}

export function getVisibleDuration(viewport: TimelineViewport): number {
	return viewport.visibleEndMs - viewport.visibleStartMs;
}

export function getZoomLevel(viewport: TimelineViewport): number {
	const visibleDuration = getVisibleDuration(viewport);
	if (visibleDuration <= 0) return 1;
	return viewport.totalDurationMs / visibleDuration;
}

export function timeToViewportPosition(
	timeMs: number,
	viewport: TimelineViewport,
): number {
	const visibleDuration = getVisibleDuration(viewport);
	if (visibleDuration <= 0) return 0;
	return (timeMs - viewport.visibleStartMs) / visibleDuration;
}

export function viewportPositionToTime(
	position: number,
	viewport: TimelineViewport,
): number {
	const visibleDuration = getVisibleDuration(viewport);
	return viewport.visibleStartMs + position * visibleDuration;
}

export function timeToTotalPosition(
	timeMs: number,
	viewport: TimelineViewport,
): number {
	if (viewport.totalDurationMs <= 0) return 0;
	return timeMs / viewport.totalDurationMs;
}

export function isTimeRangeVisible(
	startMs: number,
	endMs: number,
	viewport: TimelineViewport,
): boolean {
	return endMs > viewport.visibleStartMs && startMs < viewport.visibleEndMs;
}

export function isFullyZoomedOut(viewport: TimelineViewport): boolean {
	return (
		viewport.visibleStartMs <= 0 &&
		viewport.visibleEndMs >= viewport.totalDurationMs
	);
}

export function clampViewport(viewport: TimelineViewport): TimelineViewport {
	const visibleDuration = getVisibleDuration(viewport);
	const clampedDuration = Math.min(visibleDuration, viewport.totalDurationMs);

	let start = viewport.visibleStartMs;
	let end = viewport.visibleEndMs;

	// Ensure we don't exceed the total duration
	if (clampedDuration < visibleDuration) {
		end = start + clampedDuration;
	}

	// Clamp to bounds
	if (start < 0) {
		start = 0;
		end = clampedDuration;
	}

	if (end > viewport.totalDurationMs) {
		end = viewport.totalDurationMs;
		start = Math.max(0, end - clampedDuration);
	}

	return {
		visibleStartMs: start,
		visibleEndMs: end,
		totalDurationMs: viewport.totalDurationMs,
	};
}
