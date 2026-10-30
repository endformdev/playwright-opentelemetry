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

/** How much of the visible window a focused time range should occupy. */
export interface FrameTolerance {
	/** Zoom in when the range is narrower than this fraction of the window */
	minFraction: number;
	/** Zoom out when the range is wider than this fraction of the window */
	maxFraction: number;
	/** Fraction of the window kept clear at each edge of a range in frame */
	edgeMargin: number;
}

export const DEFAULT_FRAME_TOLERANCE: FrameTolerance = {
	minFraction: 0.15,
	maxFraction: 0.6,
	edgeMargin: 0.05,
};

/** Narrowest window the wheel zoom limits allow for a timeline. */
export function getMinVisibleDuration(totalDurationMs: number): number {
	return Math.min(
		totalDurationMs,
		Math.max(MIN_VISIBLE_DURATION_MS, totalDurationMs / MAX_ZOOM),
	);
}

/**
 * Brings a time range into frame so it occupies a proportion of the window
 * within the tolerance. Ranges already in frame leave the viewport untouched,
 * so hopping between similar ranges does not move the timeline. Otherwise the
 * window is rescaled to the nearest tolerance edge, without passing the zoom
 * limits, and centered on the range.
 */
export function frameTimeRange(
	viewport: TimelineViewport,
	startMs: number,
	endMs: number,
	tolerance: FrameTolerance = DEFAULT_FRAME_TOLERANCE,
): TimelineViewport {
	const visibleDuration = getVisibleDuration(viewport);
	const rangeDuration = Math.max(0, endMs - startMs);

	let targetDuration = visibleDuration;
	if (rangeDuration < visibleDuration * tolerance.minFraction) {
		// Zoom in, but never out: the user may already be past the wheel limit.
		targetDuration = Math.min(
			visibleDuration,
			Math.max(
				getMinVisibleDuration(viewport.totalDurationMs),
				rangeDuration / tolerance.minFraction,
			),
		);
	} else if (rangeDuration > visibleDuration * tolerance.maxFraction) {
		targetDuration = Math.max(
			visibleDuration,
			Math.min(viewport.totalDurationMs, rangeDuration / tolerance.maxFraction),
		);
	}

	const margin = visibleDuration * tolerance.edgeMargin;
	const isInFrame =
		targetDuration === visibleDuration &&
		startMs >= viewport.visibleStartMs + margin &&
		endMs <= viewport.visibleEndMs - margin;
	if (isInFrame) return viewport;

	const centerMs = startMs + rangeDuration / 2;
	const framed = clampViewport({
		visibleStartMs: centerMs - targetDuration / 2,
		visibleEndMs: centerMs + targetDuration / 2,
		totalDurationMs: viewport.totalDurationMs,
	});
	return framed.visibleStartMs === viewport.visibleStartMs &&
		framed.visibleEndMs === viewport.visibleEndMs
		? viewport
		: framed;
}

/**
 * The horizontal transform that draws content laid out for `to` where `from`
 * would draw it: x ↦ scale · x + translate, with x and translate as fractions
 * of the plot width and the origin at the plot's left edge.
 */
export function getViewportTransform(
	from: TimelineViewport,
	to: TimelineViewport,
): { scale: number; translate: number } {
	const fromDuration = getVisibleDuration(from);
	return {
		scale: getVisibleDuration(to) / fromDuration,
		translate: (to.visibleStartMs - from.visibleStartMs) / fromDuration,
	};
}

/**
 * The viewport shown `progress` of the way through a transform easing from
 * `from` to `to`. Every point moves linearly between its two positions, so
 * the shown mapping blends the two viewports' inverse durations.
 */
export function interpolateViewportMapping(
	from: TimelineViewport,
	to: TimelineViewport,
	progress: number,
): TimelineViewport {
	const fromDuration = getVisibleDuration(from);
	const toDuration = getVisibleDuration(to);
	const duration = 1 / ((1 - progress) / fromDuration + progress / toDuration);
	const start =
		duration *
		((1 - progress) * (from.visibleStartMs / fromDuration) +
			progress * (to.visibleStartMs / toDuration));
	return {
		visibleStartMs: start,
		visibleEndMs: start + duration,
		totalDurationMs: to.totalDurationMs,
	};
}

/** Whether moving between viewports zooms by more than `tolerance`. */
export function changesScale(
	from: TimelineViewport,
	to: TimelineViewport,
	tolerance = 0.15,
): boolean {
	const { scale } = getViewportTransform(from, to);
	return scale > 1 + tolerance || scale < 1 / (1 + tolerance);
}
