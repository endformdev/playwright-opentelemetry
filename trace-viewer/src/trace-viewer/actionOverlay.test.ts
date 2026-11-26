import { describe, expect, it } from "vitest";
import type { TraceAction } from "../trace-info-loader";
import {
	FRAME_SETTLE_MS,
	findActionOverlay,
	placeActionOverlay,
	placeContainedImage,
	SCROLL_SETTLE_MS,
} from "./actionOverlay";

const BOX = { x: 10, y: 20, width: 100, height: 40 };
const POINT = { x: 60, y: 40 };

function action(overrides: Partial<TraceAction> = {}): TraceAction {
	return {
		pageId: "page-0",
		end: 1020,
		failed: false,
		method: "click",
		inputs: [{ time: 1000, point: POINT, box: BOX }],
		...overrides,
	};
}

function frame(timestamp: number, pageId = "page-0") {
	return { timestamp, pageId };
}

/** The overlay on a frame; the page's only frame unless others are given. */
function overlayOn(
	actions: TraceAction[],
	shown: { timestamp: number; pageId: string },
	atMs: number,
	otherFrameTimes: number[] = [],
) {
	return findActionOverlay(actions, shown, atMs, [
		shown.timestamp,
		...otherFrameTimes,
	]);
}

describe("findActionOverlay", () => {
	it("shows nothing without actions", () => {
		expect(overlayOn([], frame(1000), 1000)).toBeNull();
	});

	it("shows an action on the frames taken while its call ran", () => {
		const click = action();

		for (const timestamp of [1000, 1010, 1020]) {
			expect(overlayOn([click], frame(timestamp), timestamp)).toEqual({
				method: "click",
				failed: false,
				point: POINT,
				box: BOX,
			});
		}
	});

	it("shows an action from the moment the time on display reaches its input", () => {
		const click = action();
		const before = frame(400);

		expect(overlayOn([click], before, 999)).toBeNull();
		expect(overlayOn([click], before, 1000)).not.toBeNull();
	});

	it("draws on the frame the page was showing when the input came, however old", () => {
		// A page that doesn't change takes no new frames.
		const click = action();

		expect(overlayOn([click], frame(200), 1010)).toMatchObject({
			point: POINT,
		});
		expect(overlayOn([click], frame(200), 60_000)).toMatchObject({
			point: POINT,
		});
	});

	describe("a frame from before the input", () => {
		// Playwright scrolls to an element just before it clicks, and the frame
		// showing the scroll is stamped a little later.
		const click = action({ steadyUntil: 1600 });
		const before = frame(900);

		it("isn't trusted when a frame was taken soon after the input", () => {
			expect(overlayOn([click], before, 1005, [1040])).toBeNull();
			expect(
				overlayOn([click], before, 1005, [1000 + FRAME_SETTLE_MS]),
			).toBeNull();
		});

		it("is trusted when the next frame came too late to be showing a change from before the input", () => {
			expect(
				overlayOn([click], before, 1005, [1000 + FRAME_SETTLE_MS + 1]),
			).not.toBeNull();
		});

		it("gives way to the frame taken soon after the input", () => {
			expect(overlayOn([click], frame(1040), 1012, [900])).toMatchObject({
				point: POINT,
			});
		});

		it("gives way to the last of several frames taken soon after the input", () => {
			expect(overlayOn([click], frame(1040), 1100, [900, 1080])).toBeNull();
			expect(overlayOn([click], frame(1080), 1100, [900, 1040])).not.toBeNull();
			expect(
				overlayOn([click], frame(1300), 1300, [900, 1040, 1080]),
			).not.toBeNull();
		});

		it("is trusted sooner when the element was already in place as the call began", () => {
			// Measured there 80 ms before the input, while Playwright waited
			// for it to be ready.
			const unmoved = action({ steadySince: 920, steadyUntil: 1600 });

			expect(overlayOn([click], before, 1005, [1040])).toBeNull();
			expect(overlayOn([unmoved], before, 1005, [1040])).toMatchObject({
				point: POINT,
			});
			expect(overlayOn([unmoved], before, 1005, [1010])).toBeNull();
		});

		it("is never trusted for an action that scrolled to its element", () => {
			const scrolled = action({ steadyFrom: 1000, steadyUntil: 1600 });

			expect(overlayOn([scrolled], before, 1005)).toBeNull();
			expect(overlayOn([scrolled], before, 5000)).toBeNull();
		});

		it("is never trusted from before the element can have been there", () => {
			// The page navigated at 950: the frame before shows another document.
			const afterNavigation = action({
				steadyFrom: 950,
				steadySince: 980,
				steadyUntil: 1600,
			});

			expect(overlayOn([afterNavigation], before, 1005)).toBeNull();
			expect(overlayOn([afterNavigation], frame(960), 1005)).not.toBeNull();
		});
	});

	describe("an action that scrolled to its element", () => {
		// What a click sets off can hold up the frame that shows the scroll.
		const scrolled = action({ steadyFrom: 1000, steadyUntil: 1900 });

		it("waits longer for the frame that shows the scroll", () => {
			const late = 1000 + FRAME_SETTLE_MS + 50;

			expect(overlayOn([scrolled], frame(1003), late, [late])).toBeNull();
			expect(overlayOn([scrolled], frame(late), late, [1003])).not.toBeNull();
		});

		it("takes the frame just after the input when none follows for a long while", () => {
			expect(
				overlayOn([scrolled], frame(1003), 1500, [1000 + SCROLL_SETTLE_MS + 1]),
			).not.toBeNull();
		});

		it("doesn't wait longer for a page that navigated before the input", () => {
			const afterNavigation = action({ steadyFrom: 700, steadyUntil: 1900 });
			const late = 1000 + FRAME_SETTLE_MS + 50;

			expect(
				overlayOn([afterNavigation], frame(1003), late, [late]),
			).not.toBeNull();
		});
	});

	it("doesn't draw on a frame from after its call, when nothing says the element stayed", () => {
		const click = action();

		expect(overlayOn([click], frame(1020), 2000)).not.toBeNull();
		expect(overlayOn([click], frame(1021), 2000)).toBeNull();
	});

	it("draws on later frames for as long as the element was seen to stay put", () => {
		const click = action({ steadyUntil: 1500 });

		expect(overlayOn([click], frame(1400), 1400)).not.toBeNull();
		expect(overlayOn([click], frame(1500), 9000)).not.toBeNull();
		expect(overlayOn([click], frame(1501), 9000)).toBeNull();
	});

	it("doesn't draw on frames from after its element was last seen in place", () => {
		// The click removed the button, or navigated, well before its call ended.
		const click = action({ end: 1300, steadyUntil: 1000 });

		expect(overlayOn([click], frame(1000), 1300)).not.toBeNull();
		expect(overlayOn([click], frame(1001), 1300)).toBeNull();
	});

	it("only shows an action on frames of its own page", () => {
		expect(overlayOn([action()], frame(1010, "page-1"), 1010)).toBeNull();
	});

	it("shows the latest action the time on display has reached on the page", () => {
		const click = action({ steadyUntil: 5000 });
		const fill = action({
			method: "fill",
			end: 2010,
			inputs: [{ time: 2000, box: BOX }],
			steadyUntil: 2400,
		});
		const elsewhere = action({
			pageId: "page-1",
			method: "hover",
			end: 1810,
			inputs: [{ time: 1800, point: POINT }],
		});
		const actions = [click, elsewhere, fill];

		expect(overlayOn(actions, frame(1100), 1900)?.method).toBe("click");
		// Two calls can be a millisecond apart: the earlier one keeps the
		// screen until the later one's own input.
		expect(overlayOn(actions, frame(1100), 1999)?.method).toBe("click");
		expect(overlayOn(actions, frame(2012), 2012)).toEqual({
			method: "fill",
			failed: false,
			box: BOX,
		});
	});

	it("doesn't go back to an earlier action once a later one is over", () => {
		const click = action({ steadyUntil: 9000 });
		const fill = action({
			method: "fill",
			end: 2010,
			inputs: [{ time: 2000, box: BOX }],
			steadyUntil: 2010,
		});

		expect(overlayOn([click, fill], frame(3000), 3000)).toBeNull();
	});

	describe("input without a point, such as a fill", () => {
		it("is drawn like any other when its element stayed where it was found", () => {
			const fill = action({
				method: "fill",
				end: 1012,
				inputs: [{ time: 1000, box: BOX }],
				steadyUntil: 1400,
			});

			expect(overlayOn([fill], frame(900), 1000)).toEqual({
				method: "fill",
				failed: false,
				box: BOX,
			});
			expect(overlayOn([fill], frame(1400), 2000)).not.toBeNull();
			expect(overlayOn([fill], frame(1401), 2000)).toBeNull();
		});

		describe("that scrolled to its element", () => {
			// The box is where the element ended up, known from the call's end.
			const fill = action({
				method: "fill",
				end: 1012,
				inputs: [{ time: 1000, box: BOX }],
				steadyFrom: 1012,
				steadyUntil: 1400,
			});

			it("isn't drawn until the element is known to be there", () => {
				expect(overlayOn([fill], frame(1012), 1011)).toBeNull();
				expect(overlayOn([fill], frame(1012), 1012)).not.toBeNull();
			});

			it("isn't drawn on a frame from before the scroll", () => {
				expect(overlayOn([fill], frame(990), 1500)).toBeNull();
				expect(overlayOn([fill], frame(1011), 1500)).toBeNull();
			});

			it("is drawn on frames from then until the element was last seen in place", () => {
				expect(overlayOn([fill], frame(1012), 1500)).not.toBeNull();
				expect(overlayOn([fill], frame(1400), 1500)).not.toBeNull();
				expect(overlayOn([fill], frame(1401), 1500)).toBeNull();
			});
		});

		it("is only drawn on the frame from before it when its element was gone by the end", () => {
			// Pressing Enter navigated away.
			const press = action({
				method: "press",
				end: 1300,
				inputs: [{ time: 1000, box: BOX }],
				steadyUntil: 1000,
			});

			expect(overlayOn([press], frame(900), 1300)).not.toBeNull();
			expect(overlayOn([press], frame(1100), 1300)).toBeNull();
		});
	});

	describe("a call that retried", () => {
		const second = { x: 300, y: 300 };
		const retried = action({
			failed: true,
			end: 1900,
			inputs: [
				{ time: 1000, point: POINT, box: BOX },
				{ time: 1500, point: second, box: BOX },
			],
			steadyUntil: 1900,
		});

		it("shows the attempt the time on display has reached", () => {
			const shown = frame(900);

			expect(overlayOn([retried], shown, 1200)).toMatchObject({
				failed: true,
				point: POINT,
			});
			expect(overlayOn([retried], shown, 1499)).toMatchObject({
				point: POINT,
			});
			expect(overlayOn([retried], shown, 1500)).toMatchObject({
				point: second,
			});
		});

		it("only vouches for the last attempt on later frames", () => {
			expect(overlayOn([retried], frame(1200), 1300)).toBeNull();
			expect(overlayOn([retried], frame(1800), 1800)).toMatchObject({
				point: second,
			});
		});
	});

	it("draws a drag from where it started once it has reached its target", () => {
		const target = { x: 500, y: 360 };
		const targetBox = { x: 400, y: 300, width: 200, height: 120 };
		const drag = action({
			method: "dragAndDrop",
			end: 1100,
			inputs: [
				{ time: 1000, point: POINT, box: BOX },
				{ time: 1080, point: target, box: targetBox },
			],
		});

		expect(overlayOn([drag], frame(1000), 1010)).toEqual({
			method: "dragAndDrop",
			failed: false,
			point: POINT,
			box: BOX,
		});
		expect(overlayOn([drag], frame(1090), 1090)).toEqual({
			method: "dragAndDrop",
			failed: false,
			point: target,
			box: targetBox,
			dragFrom: POINT,
		});
	});

	it("doesn't draw a retried click as a drag", () => {
		const retried = action({
			inputs: [
				{ time: 1000, point: POINT, box: BOX },
				{ time: 1010, point: { x: 61, y: 41 }, box: BOX },
			],
		});

		expect(overlayOn([retried], frame(1015), 1015)).not.toHaveProperty(
			"dragFrom",
		);
	});

	it("shows raw mouse input, which has no element, on frames up to the end of its call", () => {
		const mouse = action({
			method: "mouseClick",
			inputs: [{ time: 1000, point: POINT }],
		});

		expect(overlayOn([mouse], frame(1010), 1010)).toEqual({
			method: "mouseClick",
			failed: false,
			point: POINT,
		});
		expect(overlayOn([mouse], frame(1021), 1100)).toBeNull();
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
