import { describe, expect, it } from "vitest";
import type { TraceAction } from "../trace-info-loader";
import {
	ACTION_HOLD_MS,
	findActionOverlay,
	POINTER_BOX_HOLD_MS,
	placeActionOverlay,
	placeContainedImage,
} from "./actionOverlay";

const clickAction: TraceAction = {
	pageId: "page-0",
	start: 1000,
	end: 1050,
	method: "click",
	point: { x: 100, y: 50 },
	box: { x: 40, y: 30, width: 120, height: 40 },
	failed: false,
};

describe("findActionOverlay", () => {
	it("shows an action at full opacity during the call and fades it out over the hold", () => {
		expect(findActionOverlay([clickAction], "page-0", 999)).toBeNull();
		expect(findActionOverlay([clickAction], "page-0", 1000)).toEqual({
			method: "click",
			failed: false,
			opacity: 1,
			point: { x: 100, y: 50 },
			box: { x: 40, y: 30, width: 120, height: 40 },
		});
		const late = findActionOverlay(
			[clickAction],
			"page-0",
			1050 + ACTION_HOLD_MS - 1,
		);
		expect(late).not.toBeNull();
		expect(late?.opacity).toBeGreaterThan(0);
		expect(late?.opacity).toBeLessThan(0.1);
		expect(
			findActionOverlay([clickAction], "page-0", 1050 + ACTION_HOLD_MS),
		).toBeNull();
	});

	it("drops the element box before the click point on successful pointer actions", () => {
		const withBox = findActionOverlay(
			[clickAction],
			"page-0",
			1050 + POINTER_BOX_HOLD_MS - 1,
		);
		expect(withBox?.box).toEqual(clickAction.box);
		expect(withBox?.opacity).toBeGreaterThan(0.9);

		const afterBox = findActionOverlay(
			[clickAction],
			"page-0",
			1050 + POINTER_BOX_HOLD_MS,
		);
		expect(afterBox?.box).toBeUndefined();
		expect(afterBox?.point).toEqual(clickAction.point);
		expect(afterBox?.opacity).toBeGreaterThan(0.9);
	});

	it("keeps the element box for the full hold window on box-only and failed actions", () => {
		const fill: TraceAction = {
			pageId: "page-0",
			start: 1000,
			end: 1050,
			method: "fill",
			box: { x: 10, y: 10, width: 200, height: 30 },
			failed: false,
		};
		const failedClick: TraceAction = { ...clickAction, failed: true };
		const at = 1050 + POINTER_BOX_HOLD_MS + 50;

		const fillOverlay = findActionOverlay([fill], "page-0", at);
		expect(fillOverlay?.box).toEqual(fill.box);

		const failedOverlay = findActionOverlay([failedClick], "page-0", at);
		expect(failedOverlay?.box).toEqual(clickAction.box);
	});

	it("immediately replaces an earlier action when a newer one starts on the same page", () => {
		const fillAction: TraceAction = {
			pageId: "page-0",
			start: 1200,
			end: 1260,
			method: "fill",
			box: { x: 10, y: 10, width: 200, height: 30 },
			failed: false,
		};

		expect(
			findActionOverlay([clickAction, fillAction], "page-0", 1199),
		).toEqual(expect.objectContaining({ method: "click" }));
		expect(
			findActionOverlay([clickAction, fillAction], "page-0", 1200),
		).toEqual({
			method: "fill",
			failed: false,
			opacity: 1,
			box: { x: 10, y: 10, width: 200, height: 30 },
		});
	});

	it("keeps pages separate", () => {
		const otherPage: TraceAction = {
			...clickAction,
			pageId: "page-1",
			start: 1100,
			end: 1150,
			method: "hover",
		};

		expect(findActionOverlay([clickAction, otherPage], "page-0", 1120)).toEqual(
			expect.objectContaining({ method: "click" }),
		);
		expect(findActionOverlay([clickAction, otherPage], "page-1", 1120)).toEqual(
			expect.objectContaining({ method: "hover" }),
		);
	});

	it("includes dragFrom only when point is present", () => {
		const drag: TraceAction = {
			pageId: "page-0",
			start: 1000,
			end: 1100,
			method: "dragAndDrop",
			point: { x: 200, y: 150 },
			dragFrom: { x: 20, y: 30 },
			failed: true,
		};

		expect(findActionOverlay([drag], "page-0", 1050)).toEqual({
			method: "dragAndDrop",
			failed: true,
			opacity: 1,
			point: { x: 200, y: 150 },
			dragFrom: { x: 20, y: 30 },
		});
	});
});

describe("placeContainedImage", () => {
	it("centers a letterboxed image inside a taller container", () => {
		expect(
			placeContainedImage(
				{ width: 800, height: 600 },
				{ width: 1600, height: 800 },
			),
		).toEqual({ x: 0, y: 100, width: 800, height: 400 });
	});

	it("centers a pillarboxed image inside a wider container", () => {
		expect(
			placeContainedImage(
				{ width: 800, height: 600 },
				{ width: 400, height: 600 },
			),
		).toEqual({ x: 200, y: 0, width: 400, height: 600 });
	});

	it("returns null when either dimension is zero", () => {
		expect(
			placeContainedImage(
				{ width: 0, height: 600 },
				{ width: 800, height: 600 },
			),
		).toBeNull();
		expect(
			placeContainedImage(
				{ width: 800, height: 600 },
				{ width: 800, height: 0 },
			),
		).toBeNull();
	});
});

describe("placeActionOverlay", () => {
	const viewport = { width: 1280, height: 720 };
	const image = { width: 640, height: 360 };

	it("scales points, boxes, and drag lines from viewport CSS pixels to image pixels", () => {
		expect(
			placeActionOverlay(
				{
					method: "dragAndDrop",
					failed: false,
					opacity: 0.8,
					point: { x: 400, y: 200 },
					dragFrom: { x: 100, y: 50 },
					box: { x: 300, y: 160, width: 200, height: 80 },
				},
				viewport,
				image,
			),
		).toEqual({
			method: "dragAndDrop",
			failed: false,
			opacity: 0.8,
			point: { x: 200, y: 100 },
			dragFrom: { x: 50, y: 25 },
			box: { x: 150, y: 80, width: 100, height: 40 },
		});
	});

	it("returns null when the image aspect ratio disagrees with the viewport", () => {
		expect(
			placeActionOverlay(
				{
					method: "click",
					failed: false,
					opacity: 1,
					point: { x: 100, y: 100 },
				},
				{ width: 1280, height: 720 },
				{ width: 400, height: 400 },
			),
		).toBeNull();
	});

	it("clips points and boxes that lie completely outside the viewport", () => {
		expect(
			placeActionOverlay(
				{
					method: "click",
					failed: false,
					opacity: 1,
					point: { x: 1500, y: 100 },
					box: { x: 1400, y: 50, width: 100, height: 40 },
				},
				viewport,
				image,
			),
		).toBeNull();

		expect(
			placeActionOverlay(
				{
					method: "fill",
					failed: false,
					opacity: 1,
					box: { x: -20, y: 100, width: 60, height: 40 },
				},
				viewport,
				image,
			),
		).toEqual({
			method: "fill",
			failed: false,
			opacity: 1,
			box: { x: -10, y: 50, width: 30, height: 20 },
		});
	});
});
