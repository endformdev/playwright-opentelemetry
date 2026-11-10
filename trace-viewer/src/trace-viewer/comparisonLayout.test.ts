import { describe, expect, it } from "vitest";
import { layOutComparison } from "./comparisonLayout";

const layout = (widthPx: number, heightPx: number, aspect = 16 / 9) =>
	layOutComparison({ widthPx, heightPx, aspect, captionPx: 0, gapPx: 0 })
		.layout;

describe("layOutComparison", () => {
	it("sizes each screenshot to fill the room it has", () => {
		expect(
			layOutComparison({
				widthPx: 1012,
				heightPx: 300,
				aspect: 2,
				captionPx: 24,
				gapPx: 12,
			}),
		).toEqual({
			layout: "side-by-side",
			imageWidthPx: 500,
			imageHeightPx: 250,
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
		const area = { widthPx: 700, heightPx: 420, aspect: 16 / 9 };
		expect(layOutComparison({ ...area, captionPx: 0, gapPx: 0 }).layout).toBe(
			"stacked",
		);
		expect(layOutComparison({ ...area, captionPx: 24, gapPx: 12 }).layout).toBe(
			"side-by-side",
		);
	});
});
