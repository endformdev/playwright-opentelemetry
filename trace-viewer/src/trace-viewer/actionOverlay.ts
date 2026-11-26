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

const DRAG_METHOD = "dragAndDrop";

/**
 * How long after the page changes the frame showing it can be stamped. Frames
 * are taken in the background: a few milliseconds behind on a quiet machine,
 * tens under load.
 */
export const FRAME_SETTLE_MS = 100;

/**
 * The same for an action known to have scrolled to its element. What the
 * click sets off can keep the page from painting the scroll for a while, and
 * the frame from just before it would have the mark in the wrong place
 * altogether, so this waits longer.
 */
export const SCROLL_SETTLE_MS = 300;

/**
 * The action to draw over a frame, and the input of it that has been reached.
 *
 * Which action: the latest on the frame's page whose first input the time on
 * display has reached. The next action on a page ends the one before it.
 *
 * Whether it's drawn depends on the frame: the mark has to belong to the
 * picture under it, so it's only drawn on a frame known to show the input's
 * element where the mark goes.
 *
 * The element is known to be there from the input until the call ended and,
 * after that, for as long as it was seen to stay put (`steadyUntil`). A frame
 * taken later may show a page that has scrolled or moved on, and gets no
 * mark.
 *
 * A frame from before the input shows the element there too, as long as
 * nothing changed in between: a page that doesn't change takes no new frames.
 * But a change takes a while to show up in a frame. So a frame from before
 * the element was first measured in place only counts when no other frame
 * was stamped within FRAME_SETTLE_MS after that.
 *
 * When the element was first measured matters most. If that was before the
 * action could have moved it (`steadySince`), frames from then on show it in
 * place. If not, Playwright may have scrolled to it a moment before the
 * input, and the frame showing that scroll trails behind: then even of the
 * frames stamped soon after the input, only the last counts. An action known
 * to have scrolled to its element (`steadyFrom`) is never drawn on a frame
 * from before it did, and gets longer for the scroll to show.
 *
 * @param atMs The moment the frame is on show for, in the frames' clock
 * @param pageFrameTimes When each frame of the frame's page was taken
 */
export function findActionOverlay(
	actions: TraceAction[],
	frame: Pick<ScreenshotInfo, "pageId" | "timestamp">,
	atMs: number,
	pageFrameTimes: number[],
): ActionOverlay | null {
	let action: TraceAction | undefined;
	for (const candidate of actions) {
		if (
			candidate.pageId === frame.pageId &&
			candidate.inputs[0].time <= atMs &&
			(!action || candidate.inputs[0].time >= action.inputs[0].time)
		) {
			action = candidate;
		}
	}
	if (!action) return null;

	let input = action.inputs[0];
	for (const candidate of action.inputs) {
		if (candidate.time <= atMs) input = candidate;
	}

	// An earlier attempt is only known to be in place at its own moment: what
	// was measured afterwards is the last attempt's element.
	let inPlaceFromMs = input.time;
	let inPlaceUntilMs = input.time;
	let settleMs = FRAME_SETTLE_MS;
	// Whether the action may have moved the element just before it was
	// measured, so that frames from just after may not show that yet.
	let mayHaveMoved = true;
	if (input === action.inputs[action.inputs.length - 1]) {
		// With nothing measured, the call's own end is all there is to go by.
		inPlaceUntilMs = Math.max(input.time, action.steadyUntil ?? action.end);
		if (action.steadySince !== undefined) {
			inPlaceFromMs = Math.min(inPlaceFromMs, action.steadySince);
			mayHaveMoved = false;
		}
		if (action.steadyFrom !== undefined) {
			if (atMs < action.steadyFrom || frame.timestamp < action.steadyFrom) {
				return null;
			}
			// From the input on, it's the action that moved the element.
			if (action.steadyFrom >= input.time) {
				inPlaceFromMs = action.steadyFrom;
				settleMs = SCROLL_SETTLE_MS;
				mayHaveMoved = true;
			}
		}
	}
	if (frame.timestamp > inPlaceUntilMs) return null;

	if (mayHaveMoved || frame.timestamp < inPlaceFromMs) {
		// The page as the element was found is on the last frame that could
		// still be showing a change from before then.
		for (const time of pageFrameTimes) {
			if (time > frame.timestamp && time <= inPlaceFromMs + settleMs) {
				return null;
			}
		}
	}

	const start = action.inputs[0].point;
	const dragged =
		action.method === DRAG_METHOD &&
		input !== action.inputs[0] &&
		!!start &&
		!!input.point;
	return {
		method: action.method,
		failed: action.failed,
		...(input.point ? { point: input.point } : {}),
		...(input.box ? { box: input.box } : {}),
		...(dragged ? { dragFrom: start } : {}),
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
 * An overlay in the pixels of the image as it's shown, from the top left of
 * the image. What falls wholly outside the frame is left out, like an element
 * the page had yet to scroll to; null when nothing is left.
 */
export function placeActionOverlay(
	overlay: ActionOverlay,
	viewport: Size,
	image: Size,
): ActionOverlay | null {
	if (!(viewport.width > 0) || !(viewport.height > 0)) return null;
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
