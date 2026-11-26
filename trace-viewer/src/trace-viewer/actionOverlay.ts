import type { ScreenshotInfo, TraceAction } from "../trace-info-loader";

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
 * What to draw over a frame for the action it shows, in CSS pixels of the
 * page's viewport.
 */
export interface ActionOverlay {
	/** Playwright's call name, such as "click" or "fill" */
	method: string;
	failed: boolean;
	/** Where pointer input landed */
	point?: Point;
	/** The element the input was for */
	box?: Rect;
	/** Where a drag that has reached its target started */
	dragFrom?: Point;
}

/**
 * What to draw over a frame: the latest action on the frame's page that the
 * time on display has reached, if the frame is one that shows it in place.
 * The next action on a page ends the one before it.
 *
 * Which frames show an action is worked out when the test runs, from where
 * its element was measured and when each frame was taken (see the reporter's
 * `placeActionsOnFrames`). An action can be drawn on a frame from just before
 * it, as a page that doesn't change takes no new frames; the time on display
 * keeps it from showing before it happened.
 *
 * @param atMs The moment the frame is on show for, in the frames' clock
 */
export function findActionOverlay(
	actions: TraceAction[],
	frame: Pick<ScreenshotInfo, "pageId" | "timestamp">,
	atMs: number,
): ActionOverlay | null {
	let action: TraceAction | undefined;
	for (const candidate of actions) {
		if (
			candidate.pageId === frame.pageId &&
			candidate.time <= atMs &&
			(!action || candidate.time >= action.time)
		) {
			action = candidate;
		}
	}
	if (
		!action ||
		frame.timestamp < action.frames.from ||
		frame.timestamp > action.frames.until
	) {
		return null;
	}
	return {
		method: action.method,
		failed: action.failed,
		...(action.point ? { point: action.point } : {}),
		...(action.box ? { box: action.box } : {}),
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
 * the image. What falls wholly outside the frame is left out, like an element
 * the page had yet to scroll to; null when nothing is left.
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
