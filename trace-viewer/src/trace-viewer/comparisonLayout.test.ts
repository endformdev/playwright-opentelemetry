import { describe, expect, it } from "vitest";
import { layOutComparison } from "./comparisonLayout";

const layout = (widthPx: number, heightPx: number, aspect = 16 / 9) =>
	layOutComparison({
		widthPx,
		heightPx,
		aspect,
		captionPx: 0,
		gapPx: 0,
		comparisonScale: 1,
	}).layout;

describe("layOutComparison", () => {
	it("sizes each screenshot to fill the room it has", () => {
		expect(
			layOutComparison({
				widthPx: 1012,
				heightPx: 300,
				aspect: 2,
				captionPx: 24,
				gapPx: 12,
				comparisonScale: 1,
			}),
		).toEqual({
			layout: "side-by-side",
			primary: { widthPx: 500, heightPx: 250 },
			comparison: { widthPx: 500, heightPx: 250 },
		});
	});

	it("shows the comparison smaller, giving the primary the room it saves", () => {
		// 912 wide fits 500 + 12 + 400
		expect(
			layOutComparison({
				widthPx: 912,
				heightPx: 300,
				aspect: 2,
				captionPx: 24,
				gapPx: 12,
				comparisonScale: 0.8,
			}),
		).toEqual({
			layout: "side-by-side",
			primary: { widthPx: 500, heightPx: 250 },
			comparison: { widthPx: 400, heightPx: 200 },
		});
	});

	it("scales the comparison down when stacked too", () => {
		// 510 high fits 24 + 250 + 12 + 24 + 200
		expect(
			layOutComparison({
				widthPx: 600,
				heightPx: 510,
				aspect: 2,
				captionPx: 24,
				gapPx: 12,
				comparisonScale: 0.8,
			}),
		).toEqual({
			layout: "stacked",
			primary: { widthPx: 500, heightPx: 250 },
			comparison: { widthPx: 400, heightPx: 200 },
		});
	});

	it("puts the two side by side in a wide area", () => {
		expect(layout(1600, 600)).toBe("side-by-side");
	});

	it("stacks the two in a narrow, tall area", () => {
		expect(layout(400, 900)).toBe("stacked");
	});

	it("keeps them side by side when either way gives the same size", () => {
		// Both ways a screenshot is 200 high: it fills half the width or half the height.
		expect(layout(800, 400, 2)).toBe("side-by-side");
	});

	it("counts the captions and the gap", () => {
		const area = {
			widthPx: 700,
			heightPx: 420,
			aspect: 16 / 9,
			comparisonScale: 1,
		};
		expect(layOutComparison({ ...area, captionPx: 0, gapPx: 0 }).layout).toBe(
			"stacked",
		);
		expect(layOutComparison({ ...area, captionPx: 24, gapPx: 12 }).layout).toBe(
			"side-by-side",
		);
	});
});
