import { describe, expect, it } from "vitest";
import { getCaptionWidthPx } from "./stepViewerLayout";

describe("getCaptionWidthPx", () => {
	it("fills the space right of a screenshot narrower than the viewer", () => {
		// The screenshot box is 1000x376: a 4:3 screenshot renders 501px wide,
		// leaving 249px each side of it, plus the 80px gutter.
		expect(getCaptionWidthPx(1160, 400, 4 / 3)).toBe(309);
	});

	it("keeps a readable minimum when the screenshot fills the width", () => {
		expect(getCaptionWidthPx(1160, 600, 16 / 9)).toBe(192);
	});

	it("stops growing past the maximum width", () => {
		expect(getCaptionWidthPx(2400, 600, 4 / 3)).toBe(352);
	});

	it("assumes the screenshot fills the width before it has loaded", () => {
		expect(getCaptionWidthPx(1160, 600, null)).toBe(192);
	});

	it("widens over the screenshot when there is little room to grow down", () => {
		// 82px between the caption's top and the next arrow: nearly cramped.
		expect(getCaptionWidthPx(1160, 240, 5)).toBe(317);
		expect(getCaptionWidthPx(1160, 200, 5)).toBe(320);
	});

	it("widens gradually as the viewer gets shorter", () => {
		const tall = getCaptionWidthPx(1160, 600, 5);
		const medium = getCaptionWidthPx(1160, 400, 5);
		const short = getCaptionWidthPx(1160, 250, 5);
		expect(tall).toBe(192);
		expect(medium).toBeGreaterThan(tall);
		expect(short).toBeGreaterThan(medium);
	});

	it("takes at most half of a narrow, short viewer for the wider caption", () => {
		expect(getCaptionWidthPx(500, 200, 5)).toBe(250);
	});
});
