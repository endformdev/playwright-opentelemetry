import { describe, expect, it } from "vitest";
import type { TraceAction } from "../trace-info-loader";
import {
	findActionOverlay,
	placeActionOverlay,
	placeContainedImage,
} from "./actionOverlay";

const BOX = { x: 10, y: 20, width: 100, height: 40 };
const POINT = { x: 60, y: 40 };

/** A click at 1000 ms, shown on the frames from 900 to 1500 ms. */
function action(overrides: Partial<TraceAction> = {}): TraceAction {
	return {
		pageId: "page-0",
		time: 1000,
		frames: { from: 900, until: 1500 },
		method: "click",
		point: POINT,
		box: BOX,
		failed: false,
		...overrides,
	};
}

function frame(timestamp: number, pageId = "page-0") {
	return { timestamp, pageId };
}

describe("findActionOverlay", () => {
	it("shows nothing without actions", () => {
		expect(findActionOverlay([], frame(1000), 1000)).toBeNull();
	});

	it("draws an action's point and box on a frame that shows it", () => {
		expect(findActionOverlay([action()], frame(1200), 1200)).toEqual({
			method: "click",
			failed: false,
			point: POINT,
			box: BOX,
		});
	});

	it("draws on every frame from the first to the last that shows it", () => {
		const click = action();

		expect(findActionOverlay([click], frame(900), 1100)).not.toBeNull();
		expect(findActionOverlay([click], frame(1500), 1600)).not.toBeNull();
		expect(findActionOverlay([click], frame(899), 1100)).toBeNull();
		expect(findActionOverlay([click], frame(1501), 1600)).toBeNull();
	});

	it("keeps drawing on such a frame however long it stays on screen", () => {
		// A page that doesn't change takes no new frames.
		expect(findActionOverlay([action()], frame(1200), 60_000)).not.toBeNull();
	});

	it("doesn't draw an action before the time on display reaches it", () => {
		// The frame from before the click is still on screen, and shows the
		// page as the click found it, but the click hasn't happened yet.
		expect(findActionOverlay([action()], frame(900), 999)).toBeNull();
		expect(findActionOverlay([action()], frame(900), 1000)).not.toBeNull();
	});

	it("only draws an action on frames of its own page", () => {
		expect(
			findActionOverlay([action()], frame(1200, "page-1"), 1200),
		).toBeNull();
	});

	it("draws the latest action the time on display has reached on the page", () => {
		const click = action({ frames: { from: 900, until: 5000 } });
		const fill = action({
			time: 2000,
			frames: { from: 2010, until: 2400 },
			method: "fill",
			point: undefined,
		});
		const elsewhere = action({ pageId: "page-1", time: 1800, method: "hover" });
		const actions = [click, elsewhere, fill];

		expect(findActionOverlay(actions, frame(1900), 1900)?.method).toBe("click");
		expect(findActionOverlay(actions, frame(2010), 2010)).toEqual({
			method: "fill",
			failed: false,
			box: BOX,
		});
	});

	it("doesn't go back to an earlier action once a later one has started", () => {
		const click = action({ frames: { from: 900, until: 9000 } });
		const fill = action({
			time: 2000,
			frames: { from: 2010, until: 2400 },
			method: "fill",
		});

		// The click's element is still in place, but the fill is what's current.
		expect(findActionOverlay([click, fill], frame(1900), 2005)).toBeNull();
		expect(findActionOverlay([click, fill], frame(3000), 3000)).toBeNull();
	});

	it("marks a failed action as failed", () => {
		expect(
			findActionOverlay([action({ failed: true })], frame(1200), 1200),
		).toMatchObject({ failed: true });
	});

	it("draws a drag from where it started", () => {
		const drag = action({
			method: "dragAndDrop",
			point: { x: 500, y: 360 },
			dragFrom: POINT,
		});

		expect(findActionOverlay([drag], frame(1200), 1200)).toEqual({
			method: "dragAndDrop",
			failed: false,
			point: { x: 500, y: 360 },
			box: BOX,
			dragFrom: POINT,
		});
	});

	it("draws no drag without a point to draw it to", () => {
		const drag = action({ point: undefined, dragFrom: POINT });

		expect(findActionOverlay([drag], frame(1200), 1200)).not.toHaveProperty(
			"dragFrom",
		);
	});
});

describe("placeContainedImage", () => {
	it("fills the width of a box that is taller than the image", () => {
		expect(
			placeContainedImage(
				{ width: 800, height: 800 },
				{ width: 1600, height: 900 },
			),
		).toEqual({ x: 0, y: 175, width: 800, height: 450 });
	});

	it("fills the height of a box that is wider than the image", () => {
		expect(
			placeContainedImage(
				{ width: 1000, height: 300 },
				{ width: 800, height: 600 },
			),
		).toEqual({ x: 300, y: 0, width: 400, height: 300 });
	});

	it("scales a small image up, as object-fit: contain does", () => {
		expect(
			placeContainedImage(
				{ width: 400, height: 400 },
				{ width: 100, height: 50 },
			),
		).toEqual({ x: 0, y: 100, width: 400, height: 200 });
	});

	it.each([
		[
			{ width: 0, height: 300 },
			{ width: 800, height: 600 },
		],
		[
			{ width: 300, height: 300 },
			{ width: 0, height: 0 },
		],
	])("has no place before both have a size", (box, image) => {
		expect(placeContainedImage(box, image)).toBeNull();
	});
});

describe("placeActionOverlay", () => {
	const viewport = { width: 1280, height: 720 };
	const image = { width: 640, height: 360 };
	const overlay = {
		method: "click",
		failed: false,
		point: { x: 640, y: 360 },
		box: { x: 600, y: 340, width: 80, height: 40 },
	};

	it("scales page pixels to the pixels of the image as shown", () => {
		expect(placeActionOverlay(overlay, viewport, image)).toEqual({
			method: "click",
			failed: false,
			point: { x: 320, y: 180 },
			box: { x: 300, y: 170, width: 40, height: 20 },
		});
	});

	it("scales each axis by its own ratio, for an image rounded to whole pixels", () => {
		const placed = placeActionOverlay(overlay, viewport, {
			width: 641,
			height: 360,
		});

		expect(placed?.point?.x).toBeCloseTo(320.5);
		expect(placed?.point?.y).toBeCloseTo(180);
	});

	it("keeps a box that is partly in the frame", () => {
		const placed = placeActionOverlay(
			{
				...overlay,
				point: undefined,
				box: { x: -50, y: 700, width: 100, height: 100 },
			},
			viewport,
			image,
		);

		expect(placed?.box).toEqual({ x: -25, y: 350, width: 50, height: 50 });
	});

	it("leaves out an element the page hadn't scrolled to", () => {
		expect(
			placeActionOverlay(
				{
					method: "fill",
					failed: false,
					box: { x: 20, y: 2000, width: 150, height: 20 },
				},
				viewport,
				image,
			),
		).toBeNull();
	});

	it("leaves out a point outside the frame and keeps the box", () => {
		const placed = placeActionOverlay(
			{ ...overlay, point: { x: 640, y: 900 } },
			viewport,
			image,
		);

		expect(placed).not.toHaveProperty("point");
		expect(placed?.box).toBeDefined();
	});

	it("places both ends of a drag", () => {
		const placed = placeActionOverlay(
			{ ...overlay, dragFrom: { x: 100, y: 100 } },
			viewport,
			image,
		);

		expect(placed?.dragFrom).toEqual({ x: 50, y: 50 });
	});

	it("draws no drag from a start that's out of the frame", () => {
		expect(
			placeActionOverlay(
				{ ...overlay, dragFrom: { x: 100, y: -400 } },
				viewport,
				image,
			),
		).not.toHaveProperty("dragFrom");
	});

	it("has no place on an image that isn't the shape of its viewport", () => {
		// A popup's first frame, before its window took its final size.
		expect(
			placeActionOverlay(
				overlay,
				{ width: 1000, height: 700 },
				{ width: 747, height: 560 },
			),
		).toBeNull();
		// Rounding to whole pixels is no mismatch.
		expect(
			placeActionOverlay(
				overlay,
				{ width: 1000, height: 700 },
				{ width: 801, height: 560 },
			),
		).not.toBeNull();
	});

	it("has no place without a viewport", () => {
		expect(
			placeActionOverlay(overlay, { width: 0, height: 0 }, image),
		).toBeNull();
	});
});
