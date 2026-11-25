import { describe, expect, it } from "vitest";
import {
	LABEL_GAP_PX,
	layoutMarkerLabels,
	type MarkerLabelInput,
	MIN_LABEL_WIDTH_PX,
	markerAtPx,
} from "./rulerMarkerLabels";

const range = (
	startPx: number,
	endPx: number,
	labelWidthPx: number | null = 100,
): MarkerLabelInput => ({ startPx, endPx, labelWidthPx });

describe("layoutMarkerLabels", () => {
	it("draws labels that fit whole at their markers", () => {
		expect(layoutMarkerLabels([range(0, 50), range(300, 400)], 1000)).toEqual([
			{ leftPx: 0, widthPx: 100 },
			{ leftPx: 300, widthPx: 100 },
		]);
	});

	it("cuts a label short where the next one starts", () => {
		expect(layoutMarkerLabels([range(0, 50), range(80, 90)], 1000)).toEqual([
			{ leftPx: 0, widthPx: 80 - LABEL_GAP_PX },
			{ leftPx: 80, widthPx: 100 },
		]);
	});

	it("leaves out a label with too little room after the one before", () => {
		const tooClose = MIN_LABEL_WIDTH_PX + LABEL_GAP_PX - 1;
		expect(
			layoutMarkerLabels(
				[range(0, 10), range(tooClose, tooClose), range(200, 210)],
				1000,
			),
		).toEqual([
			{ leftPx: 0, widthPx: 100 },
			null,
			{ leftPx: 200, widthPx: 100 },
		]);
	});

	it("lays labels out in time order, whatever the markers' order", () => {
		expect(layoutMarkerLabels([range(80, 90), range(0, 50)], 1000)).toEqual([
			{ leftPx: 80, widthPx: 100 },
			{ leftPx: 0, widthPx: 80 - LABEL_GAP_PX },
		]);
	});

	it("keeps the first of markers starting together", () => {
		expect(layoutMarkerLabels([range(10, 500), range(10, 20)], 1000)).toEqual([
			{ leftPx: 10, widthPx: 100 },
			null,
		]);
	});

	it("moves the last label left to stay on the ruler", () => {
		expect(layoutMarkerLabels([range(950, 990)], 1000)).toEqual([
			{ leftPx: 900, widthPx: 100 },
		]);
	});

	it("moves the last label left no further than the one before ends", () => {
		expect(
			layoutMarkerLabels([range(800, 810, 120), range(950, 990)], 1000),
		).toEqual([
			{ leftPx: 800, widthPx: 120 },
			{ leftPx: 920 + LABEL_GAP_PX, widthPx: 1000 - 920 - LABEL_GAP_PX },
		]);
	});

	it("cuts a label wider than the ruler to the ruler", () => {
		expect(layoutMarkerLabels([range(100, 110, 500)], 300)).toEqual([
			{ leftPx: 0, widthPx: 300 },
		]);
	});

	it("skips markers without a label", () => {
		expect(
			layoutMarkerLabels(
				[range(0, 10), range(20, 30, null), range(80, 90)],
				1000,
			),
		).toEqual([
			{ leftPx: 0, widthPx: 80 - LABEL_GAP_PX },
			null,
			{ leftPx: 80, widthPx: 100 },
		]);
	});

	it("draws no labels before the ruler has a width", () => {
		expect(layoutMarkerLabels([range(0, 0)], 0)).toEqual([null]);
	});
});

describe("markerAtPx", () => {
	it("finds the marker under the pointer, or none", () => {
		const markers = [range(100, 200), range(300, 300)];
		expect(markerAtPx(markers, 150)).toBe(0);
		expect(markerAtPx(markers, 302)).toBe(1);
		expect(markerAtPx(markers, 250)).toBeNull();
	});

	it("picks the narrowest of nested markers", () => {
		expect(markerAtPx([range(0, 500), range(100, 120)], 110)).toBe(1);
		expect(markerAtPx([range(0, 500), range(100, 120)], 50)).toBe(0);
	});
});
