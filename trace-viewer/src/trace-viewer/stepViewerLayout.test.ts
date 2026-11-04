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
});
