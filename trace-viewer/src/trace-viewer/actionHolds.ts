import type { TraceAction } from "../trace-info-loader";
import type { HeldPlayback, PlaybackHold } from "./playback";

/**
 * How long playback shows where an action is about to land, before its
 * input: long enough to find the place on the page.
 */
export const AIM_HOLD_MS = 380;
/** How long playback stays on an action once its input has landed. */
export const LANDED_HOLD_MS = 320;
/**
 * The same two holds between actions that follow each other closely, like
 * the fields of a form: the eye is already there, so they go by quicker.
 */
export const BURST_AIM_HOLD_MS = 200;
export const BURST_LANDED_HOLD_MS = 180;
/** Actions follow each other closely with less than this between them. */
export const BURST_GAP_MS = 200;
/** How long playback stays on an action that failed. */
export const FAILED_HOLD_MS = 1000;

/**
 * Playback waiting at an action: first at where it is about to land, then
 * with its input landed. Both are at the moment the input began, on the page
 * as the action found it, before the page reacts.
 */
export interface ActionHold extends PlaybackHold {
	action: TraceAction;
	/** How much of the hold comes before the input */
	aimMs: number;
}

/** The part of an action's hold playback is in, drawn on the screenshot. */
export interface ActionHoldPhase {
	action: TraceAction;
	phase: "aim" | "landed";
	/** How far through the phase, from 0 to 1 */
	progress: number;
}

/**
 * The holds playback makes for a test's actions, in the order it meets them.
 * An action is only held on when its page is the one on show as its input
 * begins: a wait with nothing marked would only look stuck.
 *
 * @param shownPageIdAt The page on show at a moment in the screenshots'
 * clock, or null with none
 */
export function computeActionHolds(
	actions: readonly TraceAction[],
	testStartTimeMs: number,
	shownPageIdAt: (atMs: number) => string | null,
): ActionHold[] {
	const shown = actions
		.filter((action) => shownPageIdAt(action.start) === action.pageId)
		.sort((a, b) => a.start - b.start);
	return shown.map((action, index) => {
		const previous = shown[index - 1];
		const next = shown[index + 1];
		const followsClosely =
			previous !== undefined && action.start - previous.end < BURST_GAP_MS;
		const followedClosely =
			next !== undefined && next.start - action.end < BURST_GAP_MS;
		const aimMs = followsClosely ? BURST_AIM_HOLD_MS : AIM_HOLD_MS;
		const landedMs = action.failed
			? FAILED_HOLD_MS
			: followedClosely
				? BURST_LANDED_HOLD_MS
				: LANDED_HOLD_MS;
		return {
			timeMs: Math.max(0, action.start - testStartTimeMs),
			durationMs: aimMs + landedMs,
			action,
			aimMs,
		};
	});
}

/** The phase of the hold playback is waiting at, or null while it moves. */
export function getActionHoldPhase(
	holds: readonly ActionHold[],
	held: HeldPlayback | null,
): ActionHoldPhase | null {
	const hold = held ? holds[held.index] : undefined;
	if (!held || !hold) return null;
	const { action, aimMs, durationMs } = hold;
	if (held.heldMs < aimMs) {
		return { action, phase: "aim", progress: held.heldMs / aimMs };
	}
	const landedMs = durationMs - aimMs;
	return {
		action,
		phase: "landed",
		progress: landedMs > 0 ? Math.min(1, (held.heldMs - aimMs) / landedMs) : 1,
	};
}
