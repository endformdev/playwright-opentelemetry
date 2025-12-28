import { describe, expect, it } from "vitest";

import {
	type Screenshot,
	selectScreenshots,
	type TimeRange,
	viewportToTimeRange,
} from "./selectScreenshots";
import { createViewport, zoomToRange } from "./viewport";

function makeScreenshots(...timestamps: number[]): Screenshot[] {
	return timestamps.map((timestamp) => ({ timestamp }));
}

function getTimestamps(screenshots: Screenshot[]): number[] {
	return screenshots.map((s) => s.timestamp);
}

describe("selectScreenshots", () => {
	describe("without time range (legacy behavior)", () => {
		it("returns empty array when no screenshots or zero slots", () => {
			expect(selectScreenshots([], 5)).toEqual([]);
			expect(selectScreenshots(makeScreenshots(1000), 0)).toEqual([]);
			expect(selectScreenshots(makeScreenshots(1000), -1)).toEqual([]);
		});

		it("fills all slots with single screenshot", () => {
			const result = selectScreenshots(makeScreenshots(1000), 5);
			expect(getTimestamps(result)).toEqual([1000, 1000, 1000, 1000, 1000]);
		});

		it("distributes fewer screenshots across more slots evenly", () => {
			const result = selectScreenshots(makeScreenshots(1000, 2000), 4);
			expect(getTimestamps(result)).toEqual([1000, 1000, 2000, 2000]);
		});

		it("returns all screenshots sorted when count equals slots", () => {
			const result = selectScreenshots(makeScreenshots(3000, 1000, 2000), 3);
			expect(getTimestamps(result)).toEqual([1000, 2000, 3000]);
		});

		it("selects evenly distributed screenshots from larger set", () => {
			const screenshots = makeScreenshots(
				0,
				1000,
				2000,
				3000,
				4000,
				5000,
				6000,
				7000,
				8000,
				9000,
			);
			const result = selectScreenshots(screenshots, 4);
			expect(getTimestamps(result)).toEqual([0, 3000, 6000, 9000]);
		});

		it("selects closest screenshots when exact timestamps dont exist", () => {
			const screenshots = makeScreenshots(100, 250, 800, 900, 1000);
			const result = selectScreenshots(screenshots, 3);
			expect(getTimestamps(result)).toEqual([100, 800, 1000]);
		});

		it("selects middle screenshot when requesting 1 from many", () => {
			const result = selectScreenshots(
				makeScreenshots(1000, 2000, 3000, 4000, 5000),
				1,
			);
			expect(getTimestamps(result)).toEqual([3000]);
		});

		it("handles all screenshots with same timestamp", () => {
			const screenshots = makeScreenshots(1000, 1000, 1000, 1000);
			expect(selectScreenshots(screenshots, 2)).toHaveLength(2);
			expect(selectScreenshots(screenshots, 6)).toHaveLength(6);
		});

		it("preserves additional properties on screenshots", () => {
			const screenshots = [
				{ timestamp: 1000, url: "a.png" },
				{ timestamp: 2000, url: "b.png" },
			];
			const result = selectScreenshots(screenshots, 4);
			expect(result[0].url).toBe("a.png");
			expect(result[3].url).toBe("b.png");
		});
	});

	describe("with time range (viewport-aware)", () => {
		it("returns empty array when no screenshots", () => {
			const range: TimeRange = { startMs: 0, endMs: 1000 };
			expect(selectScreenshots([], 5, range)).toEqual([]);
		});

		it("selects screenshots within the time range", () => {
			const screenshots = makeScreenshots(100, 500, 1000, 1500, 2000);
			const range: TimeRange = { startMs: 400, endMs: 1100 };
			const result = selectScreenshots(screenshots, 3, range);
			// Should select from screenshots in range [500, 1000]
			expect(getTimestamps(result)).toEqual([500, 1000, 1000]);
		});

		it("distributes across the range when multiple screenshots exist", () => {
			const screenshots = makeScreenshots(0, 250, 500, 750, 1000);
			const range: TimeRange = { startMs: 0, endMs: 1000 };
			const result = selectScreenshots(screenshots, 3, range);
			// Should pick from start, middle, and end of range
			expect(getTimestamps(result)).toEqual([0, 500, 1000]);
		});

		it("finds closest screenshots when none are in range", () => {
			const screenshots = makeScreenshots(100, 200, 800, 900);
			// Range is between the two groups of screenshots
			const range: TimeRange = { startMs: 400, endMs: 600 };
			const result = selectScreenshots(screenshots, 3, range);
			// Should find 200 (closest before) and 800 (closest after)
			expect(getTimestamps(result)).toContain(200);
			expect(getTimestamps(result)).toContain(800);
		});

		it("finds closest before when range is after all screenshots", () => {
			const screenshots = makeScreenshots(100, 200, 300);
			const range: TimeRange = { startMs: 500, endMs: 1000 };
			const result = selectScreenshots(screenshots, 3, range);
			// Should use the closest screenshot (300) and repeat it
			expect(getTimestamps(result)).toEqual([300, 300, 300]);
		});

		it("finds closest after when range is before all screenshots", () => {
			const screenshots = makeScreenshots(500, 600, 700);
			const range: TimeRange = { startMs: 0, endMs: 200 };
			const result = selectScreenshots(screenshots, 3, range);
			// Should use the closest screenshot (500) and repeat it
			expect(getTimestamps(result)).toEqual([500, 500, 500]);
		});

		it("handles single screenshot in range", () => {
			const screenshots = makeScreenshots(100, 500, 900);
			const range: TimeRange = { startMs: 400, endMs: 600 };
			const result = selectScreenshots(screenshots, 4, range);
			// Only 500 is in range, should repeat it
			expect(getTimestamps(result)).toEqual([500, 500, 500, 500]);
		});

		it("handles range with only one boundary screenshot", () => {
			const screenshots = makeScreenshots(100, 500, 900);
			// Range starts exactly at a screenshot
			const range: TimeRange = { startMs: 500, endMs: 700 };
			const result = selectScreenshots(screenshots, 3, range);
			expect(getTimestamps(result)).toEqual([500, 500, 500]);
		});

		it("prioritizes closer screenshot when between groups", () => {
			const screenshots = makeScreenshots(100, 900);
			// Range is closer to 100
			const range: TimeRange = { startMs: 200, endMs: 300 };
			const result = selectScreenshots(screenshots, 2, range);
			// 100 is closer (distance 100) than 900 (distance 600)
			expect(result[0].timestamp).toBe(100);
		});

		it("selects evenly from range when many screenshots available", () => {
			const screenshots = makeScreenshots(
				0,
				100,
				200,
				300,
				400,
				500,
				600,
				700,
				800,
				900,
				1000,
			);
			// Zoom into middle portion
			const range: TimeRange = { startMs: 300, endMs: 700 };
			const result = selectScreenshots(screenshots, 3, range);
			// Should select from 300-700 range: start, middle, end
			expect(getTimestamps(result)).toEqual([300, 500, 700]);
		});
	});

	describe("viewportToTimeRange", () => {
		it("converts a full viewport to time range", () => {
			const viewport = createViewport(1000);
			const range = viewportToTimeRange(viewport);
			expect(range.startMs).toBe(0);
			expect(range.endMs).toBe(1000);
		});

		it("converts a zoomed viewport to time range", () => {
			const viewport = createViewport(1000);
			const zoomed = zoomToRange(viewport, 250, 750, 0);
			const range = viewportToTimeRange(zoomed);
			expect(range.startMs).toBe(250);
			expect(range.endMs).toBe(750);
		});
	});

	describe("integration with viewport zooming", () => {
		it("shows all screenshots when fully zoomed out", () => {
			const screenshots = makeScreenshots(0, 250, 500, 750, 1000);
			const viewport = createViewport(1000);
			const range = viewportToTimeRange(viewport);
			const result = selectScreenshots(screenshots, 3, range);
			// Should pick from full range
			expect(getTimestamps(result)).toEqual([0, 500, 1000]);
		});

		it("shows subset when zoomed into a region", () => {
			const screenshots = makeScreenshots(0, 250, 500, 750, 1000);
			const viewport = createViewport(1000);
			const zoomed = zoomToRange(viewport, 200, 600, 0);
			const range = viewportToTimeRange(zoomed);
			const result = selectScreenshots(screenshots, 3, range);
			// Range is 200-600, contains 250 and 500
			expect(getTimestamps(result)).toEqual([250, 500, 500]);
		});

		it("shows closest screenshots when zoomed into empty region", () => {
			const screenshots = makeScreenshots(100, 200, 800, 900);
			const viewport = createViewport(1000);
			// Zoom into region with no screenshots
			const zoomed = zoomToRange(viewport, 400, 600, 0);
			const range = viewportToTimeRange(zoomed);
			const result = selectScreenshots(screenshots, 4, range);
			// Should show the closest: 200 (before) and 800 (after)
			expect(getTimestamps(result)).toContain(200);
			expect(getTimestamps(result)).toContain(800);
		});
	});
});
