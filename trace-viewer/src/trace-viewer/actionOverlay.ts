import type { TraceAction } from "../trace-info-loader";

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
 * How long an action's mark fades out after the call ends, unless another
 * action on the same page replaces it. Letting it fade smoothly keeps fast
 * clicks and fills legible during playback and reads naturally when the page
 * navigates or updates right after a click.
 */
export const ACTION_HOLD_MS = 500;

/**
 * How long the target element's box lingers after a successful pointer action
 * (click, drag, hover). Because a click often dismisses a modal or navigates
 * immediately, the box fades away quickly while the click ripple lingers a bit
 * longer to show where the click landed.
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
	/** Overall opacity (0..1): 1 during the call, fading out across the hold window */
	opacity: number;
	/** Element box opacity (0..1): fades faster than the point on successful pointer actions */
	boxOpacity: number;
	/** 0 during the call, rising linearly to 1 across the post-action hold window */
	fadeProgress: number;
	/** Where pointer input landed */
	point?: Point;
	/** The element the input was for */
	box?: Rect;
	/** Where a drag started */
	dragFrom?: Point;
}

/**
 * Picks the action to draw for `pageId` at `atMs`: the latest action on that
 * page whose `start` has been reached, fading out over `holdMs` after `end`.
 * Any newer action on the same page replaces the one before it.
 *
 * @param atMs The moment on display, in the screenshots' clock
 */
export function findActionOverlay(
	actions: TraceAction[],
	pageId: string,
	atMs: number,
	holdMs = ACTION_HOLD_MS,
): ActionOverlay | null {
	let action: TraceAction | undefined;
	for (const candidate of actions) {
		if (
			candidate.pageId === pageId &&
			candidate.start <= atMs &&
			(!action || candidate.start >= action.start)
		) {
			action = candidate;
		}
	}
	if (!action) return null;
	const afterMs = Math.max(0, atMs - action.end);
	if (afterMs > 0 && afterMs >= holdMs) {
		return null;
	}

	// Ease-out fade: stays clear right after a fast call, then melts away.
	const fadeProgress = afterMs > 0 && holdMs > 0 ? afterMs / holdMs : 0;
	const opacity = 1 - fadeProgress * fadeProgress;

	let box = action.box;
	let boxOpacity = box ? opacity : 0;
	if (box && action.point && !action.failed && afterMs > 0) {
		const boxHoldMs = Math.min(holdMs, POINTER_BOX_HOLD_MS);
		if (afterMs >= boxHoldMs) {
			box = undefined;
			boxOpacity = 0;
		} else {
			// Ease-in fade: steps back quickly once the click finishes.
			const remaining = 1 - afterMs / boxHoldMs;
			boxOpacity = remaining * remaining;
		}
	}

	return {
		method: action.method,
		failed: action.failed,
		opacity,
		boxOpacity,
		fadeProgress,
		...(action.point ? { point: action.point } : {}),
		...(box ? { box } : {}),
		...(action.dragFrom && action.point ? { dragFrom: action.dragFrom } : {}),
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
		boxOpacity: box ? overlay.boxOpacity : 0,
		fadeProgress: overlay.fadeProgress,
		...(point ? { point } : {}),
		...(box ? { box } : {}),
		...(dragFrom ? { dragFrom } : {}),
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
