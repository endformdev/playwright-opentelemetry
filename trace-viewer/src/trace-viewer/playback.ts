import { panViewport, type TimelineViewport } from "./viewport";

/** Playback speeds, in the order the speed button cycles through them. */
export const PLAYBACK_SPEEDS = [1, 2, 0.5] as const;

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/**
 * Longest real time one frame may advance playback by. After a stall (a
 * hidden tab, a long task) playback resumes where it was rather than jumping.
 */
export const MAX_PLAYBACK_FRAME_MS = 100;

/** Where the playhead sits after the timeline pages along to follow it. */
const FOLLOW_LEAD_FRACTION = 0.1;
/** How far across the visible window the playhead gets before paging. */
const FOLLOW_EDGE_FRACTION = 0.9;

export function nextPlaybackSpeed(speed: PlaybackSpeed): PlaybackSpeed {
	const index = PLAYBACK_SPEEDS.indexOf(speed);
	return PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length];
}

export function formatPlaybackSpeed(speed: PlaybackSpeed): string {
	return `${speed}×`;
}

/**
 * Where pressing play starts: the locked time, or with nothing locked the
 * start of what is in view. From the very end it starts over.
 */
export function getPlaybackStartMs(
	lockedTimeMs: number | null,
	viewport: TimelineViewport,
	endMs: number,
): number {
	const startMs = lockedTimeMs ?? viewport.visibleStartMs;
	if (startMs >= endMs) return 0;
	return Math.max(0, startMs);
}

/** The playhead after `elapsedMs` of real time, stopping at the end. */
export function advancePlayback(
	timeMs: number,
	elapsedMs: number,
	speed: PlaybackSpeed,
	endMs: number,
): number {
	const realMs = Math.min(Math.max(0, elapsedMs), MAX_PLAYBACK_FRAME_MS);
	return Math.min(endMs, timeMs + realMs * speed);
}

/**
 * The viewport that keeps the playhead in view, or null when it already is.
 * Rather than scrolling every frame, the timeline pages along: once the
 * playhead nears the right edge (or is out of view) the window moves to put
 * it just inside the left edge, keeping the zoom.
 */
export function followPlayhead(
	viewport: TimelineViewport,
	timeMs: number,
): TimelineViewport | null {
	const visibleMs = viewport.visibleEndMs - viewport.visibleStartMs;
	const edgeMs = viewport.visibleStartMs + visibleMs * FOLLOW_EDGE_FRACTION;
	if (timeMs >= viewport.visibleStartMs && timeMs <= edgeMs) return null;

	const targetStartMs = timeMs - visibleMs * FOLLOW_LEAD_FRACTION;
	const next = panViewport(viewport, targetStartMs - viewport.visibleStartMs);
	// Pinned against the end of the trace, the window cannot move any further.
	if (
		next.visibleStartMs === viewport.visibleStartMs &&
		next.visibleEndMs === viewport.visibleEndMs
	) {
		return null;
	}
	return next;
}
