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
 * The speed playback has until one is chosen. With holds it spends its time
 * on the actions, so it moves between them at double speed.
 */
export function getDefaultPlaybackSpeed(holding: boolean): PlaybackSpeed {
	return holding ? 2 : 1;
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

/** A moment playback waits at, so that what happens there can be seen. */
export interface PlaybackHold {
	/** Where playback waits, relative to test start */
	timeMs: number;
	/** How long it waits, in real time whatever the speed */
	durationMs: number;
}

/** Where playback is: a time, and how far through the holds it has got. */
export interface PlaybackPosition {
	timeMs: number;
	/** Index of the next hold to wait at; the ones before it are done with */
	nextHold: number;
	/** How long playback has waited at that hold, once it is there */
	heldMs: number;
}

/** The hold a position is waiting at. */
export interface HeldPlayback {
	/** Index of the hold */
	index: number;
	/** How long playback has waited there so far */
	heldMs: number;
}

/**
 * Playback starting at a time. It waits at a hold at that very time, and
 * leaves the ones before it behind.
 */
export function startPlayback(
	timeMs: number,
	holds: readonly PlaybackHold[] = [],
): PlaybackPosition {
	const next = holds.findIndex((hold) => hold.timeMs >= timeMs);
	return { timeMs, nextHold: next === -1 ? holds.length : next, heldMs: 0 };
}

/**
 * A position carried over to other holds, as when they are switched on while
 * playing. It doesn't wait where it already is: only at the holds ahead.
 */
export function rejoinPlayback(
	timeMs: number,
	holds: readonly PlaybackHold[],
): PlaybackPosition {
	const next = holds.findIndex((hold) => hold.timeMs > timeMs);
	return { timeMs, nextHold: next === -1 ? holds.length : next, heldMs: 0 };
}

/** The hold to wait at next, unless it lies past the end. */
function pendingHold(
	position: PlaybackPosition,
	holds: readonly PlaybackHold[],
	endMs: number,
): PlaybackHold | null {
	const hold = holds[position.nextHold];
	return hold && hold.timeMs <= endMs ? hold : null;
}

/** The hold playback is waiting at, or null while it is moving. */
export function getHeldPlayback(
	position: PlaybackPosition,
	holds: readonly PlaybackHold[],
	endMs: number,
): HeldPlayback | null {
	const hold = pendingHold(position, holds, endMs);
	return hold && hold.timeMs <= position.timeMs
		? { index: position.nextHold, heldMs: position.heldMs }
		: null;
}

/** Whether playback has reached the end, with no hold left to wait at. */
export function isPlaybackOver(
	position: PlaybackPosition,
	holds: readonly PlaybackHold[],
	endMs: number,
): boolean {
	return position.timeMs >= endMs && !pendingHold(position, holds, endMs);
}

/**
 * Where playback is after `elapsedMs` of real time. The speed scales the time
 * it moves through; at a hold it waits the hold's whole duration at any
 * speed, then moves on. It stops at the end.
 */
export function advancePlayback(
	position: PlaybackPosition,
	elapsedMs: number,
	speed: PlaybackSpeed,
	endMs: number,
	holds: readonly PlaybackHold[] = [],
): PlaybackPosition {
	let realMs = Math.min(Math.max(0, elapsedMs), MAX_PLAYBACK_FRAME_MS);
	let { timeMs, nextHold, heldMs } = position;
	for (;;) {
		const hold = pendingHold({ timeMs, nextHold, heldMs }, holds, endMs);
		if (hold && hold.timeMs <= timeMs) {
			const leftMs = hold.durationMs - heldMs;
			if (realMs < leftMs) return { timeMs, nextHold, heldMs: heldMs + realMs };
			realMs -= leftMs;
			nextHold += 1;
			heldMs = 0;
			continue;
		}
		const untilMs = hold?.timeMs ?? endMs;
		const reachedMs = timeMs + realMs * speed;
		if (reachedMs < untilMs) return { timeMs: reachedMs, nextHold, heldMs: 0 };
		realMs -= (untilMs - timeMs) / speed;
		timeMs = untilMs;
		if (!hold) return { timeMs, nextHold, heldMs: 0 };
	}
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
