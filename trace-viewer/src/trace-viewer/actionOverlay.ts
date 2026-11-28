import type { TraceAction } from "../trace-info-loader";
import type { ActionHoldPhase } from "./actionHolds";

export interface Point {
	x: number;
	y: number;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Size {
	width: number;
	height: number;
}

/**
 * How long an action's mark fades out after its call ends, unless a newer
 * action on the same page replaces it. Long enough to read a fast click or
 * fill during playback.
 */
export const ACTION_HOLD_MS = 750;

/**
 * How long the element's box stays after a pointer action (click, drag,
 * hover) succeeds. A click often closes a dialog or navigates straight away,
 * so the box goes quickly while the point stays to show where it landed.
 */
export const POINTER_BOX_HOLD_MS = 120;

/**
 * What to draw over a screenshot for the action on display, in CSS pixels of
 * the page's viewport.
 */
export interface ActionOverlay {
	/** Playwright's call name, such as "click" or "fill" */
	method: string;
	failed: boolean;
	/** 1 until the call ends, then fading to 0 over the hold */
	opacity: number;
	/** Where pointer input landed */
	point?: Point;
	/** The element the input was for */
	box?: Rect;
	/** Where a drag started */
	dragFrom?: Point;
	/**
	 * The part of a playback hold the action is drawn in: aiming, with only
	 * where the input is about to land, or with the input just landed
	 */
	hold?: Pick<ActionHoldPhase, "phase" | "progress">;
}

/**
 * Picks the action to draw for `pageId` at `atMs`: the latest action on that
 * page whose `start` has been reached, fading out over `ACTION_HOLD_MS` after
 * its `end`.
 * Any newer action on the same page replaces the one before it.
 *
 * While playback holds on the action, the mark says which part of the hold it
 * is in, and the element's box stays for all of it.
 *
 * @param actions Ordered by start time
 * @param atMs The moment on display, in the screenshots' clock
 * @param held The hold playback is waiting at, if any
 */
export function findActionOverlay(
	actions: TraceAction[],
	pageId: string,
	atMs: number,
	held: ActionHoldPhase | null = null,
): ActionOverlay | null {
	let action: TraceAction | undefined;
	for (const candidate of actions) {
		if (candidate.start > atMs) break;
		if (candidate.pageId === pageId) action = candidate;
	}
	if (!action) return null;
	const afterMs = Math.max(0, atMs - action.end);
	if (afterMs >= ACTION_HOLD_MS) return null;

	// Ease out: stays clear just after a fast call, then melts away.
	const fade = afterMs / ACTION_HOLD_MS;
	const hold = held?.action === action ? held : null;
	const keepBox =
		!action.point ||
		action.failed ||
		afterMs < POINTER_BOX_HOLD_MS ||
		hold !== null;
	return {
		method: action.method,
		failed: action.failed,
		opacity: hold ? 1 : 1 - fade * fade,
		...(action.point ? { point: action.point } : {}),
		...(action.box && keepBox ? { box: action.box } : {}),
		...(action.dragFrom && action.point ? { dragFrom: action.dragFrom } : {}),
		...(hold ? { hold: { phase: hold.phase, progress: hold.progress } } : {}),
	};
}

/**
 * Where an image sits inside the box of an element that shows it with
 * `object-fit: contain`: as large as fits, centred. Null when either has no
 * area yet.
 */
export function placeContainedImage(box: Size, image: Size): Rect | null {
	if (
		!(box.width > 0) ||
		!(box.height > 0) ||
		!(image.width > 0) ||
		!(image.height > 0)
	) {
		return null;
	}
	const scale = Math.min(box.width / image.width, box.height / image.height);
	const width = image.width * scale;
	const height = image.height * scale;
	return {
		x: (box.width - width) / 2,
		y: (box.height - height) / 2,
		width,
		height,
	};
}

/**
 * How far an image's shape may stray from its viewport's before the two are
 * taken not to belong together: frames are scaled to whole pixels.
 */
const MAX_ASPECT_MISMATCH = 0.02;

/**
 * An overlay in the pixels of the image as it's shown, from the top left of
 * the image. What falls wholly outside the frame is left out; null when
 * nothing is left.
 *
 * Also null when the image isn't the shape of the viewport it says it shows:
 * a popup's first frames can come before its window has its final size, still
 * labelled with the size it's about to have.
 */
export function placeActionOverlay(
	overlay: ActionOverlay,
	viewport: Size,
	image: Size,
): ActionOverlay | null {
	if (!(viewport.width > 0) || !(viewport.height > 0)) return null;
	const imageAspect = image.width / image.height;
	const viewportAspect = viewport.width / viewport.height;
	if (Math.abs(imageAspect / viewportAspect - 1) > MAX_ASPECT_MISMATCH) {
		return null;
	}
	const scaleX = image.width / viewport.width;
	const scaleY = image.height / viewport.height;
	const place = (point: Point): Point => ({
		x: point.x * scaleX,
		y: point.y * scaleY,
	});
	const inFrame = (point: Point) =>
		point.x >= 0 &&
		point.y >= 0 &&
		point.x <= viewport.width &&
		point.y <= viewport.height;

	const point =
		overlay.point && inFrame(overlay.point) ? place(overlay.point) : undefined;
	const box =
		overlay.box && overlapsFrame(overlay.box, viewport)
			? {
					...place(overlay.box),
					width: overlay.box.width * scaleX,
					height: overlay.box.height * scaleY,
				}
			: undefined;
	if (!point && !box) return null;
	// A drag is drawn to its point; without that there's nowhere to draw it to.
	const dragFrom =
		point && overlay.dragFrom && inFrame(overlay.dragFrom)
			? place(overlay.dragFrom)
			: undefined;

	return {
		method: overlay.method,
		failed: overlay.failed,
		opacity: overlay.opacity,
		...(point ? { point } : {}),
		...(box ? { box } : {}),
		...(dragFrom ? { dragFrom } : {}),
		...(overlay.hold ? { hold: overlay.hold } : {}),
	};
}

function overlapsFrame(box: Rect, viewport: Size): boolean {
	return (
		box.x < viewport.width &&
		box.y < viewport.height &&
		box.x + box.width > 0 &&
		box.y + box.height > 0
	);
}
