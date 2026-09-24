import { describe, expect, it } from "vitest";

import {
	type Screenshot,
	type SlotScreenshot,
	selectScreenshots,
	type TimeRange,
	viewportToTimeRange,
} from "./selectScreenshots";
import { createViewport, zoomToRange } from "./viewport";

function makeScreenshots(...timestamps: number[]): Screenshot[] {
	return timestamps.map((timestamp) => ({ timestamp }));
}

function getTimestamps(
	screenshots: SlotScreenshot<Screenshot>[],
): (number | null)[] {
	return screenshots.map((s) => (s ? s.timestamp : null));
}

describe("selectScreenshots", () => {
	describe("basic edge cases", () => {
		it("returns empty array when zero slots requested", () => {
			expect(selectScreenshots(makeScreenshots(1000), 0)).toEqual([]);
			expect(selectScreenshots(makeScreenshots(1000), -1)).toEqual([]);
		});

		it("returns all nulls when no screenshots available", () => {
			const result = selectScreenshots([], 5);
			expect(result).toEqual([null, null, null, null, null]);
		});
	});

	describe("slot-boundary selection (without explicit time range)", () => {
		it("fills all slots with single screenshot", () => {
			const result = selectScreenshots(makeScreenshots(1000), 5);
			expect(getTimestamps(result)).toEqual([1000, 1000, 1000, 1000, 1000]);
		});

		it("distributes two screenshots across four slots based on time boundaries", () => {
			const result = selectScreenshots(makeScreenshots(1000, 2000), 4);
			expect(getTimestamps(result)).toEqual([1000, 1000, 1000, 1000]);
		});

		it("selects by start time even when screenshot count equals slot count", () => {
			const result = selectScreenshots(makeScreenshots(3000, 1000, 2000), 3);
			expect(getTimestamps(result)).toEqual([1000, 1000, 2000]);
		});

		it("selects screenshots respecting slot boundaries from larger set", () => {
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
			expect(getTimestamps(result)).toEqual([0, 2000, 4000, 6000]);
		});

		it("preserves additional properties on screenshots", () => {
			const screenshots = [
				{ timestamp: 1000, url: "a.png" },
				{ timestamp: 2000, url: "b.png" },
			];
			const result = selectScreenshots(screenshots, 4);
			expect(result[0]?.url).toBe("a.png");
			expect(result[3]?.url).toBe("a.png");
		});
	});

	describe("with time range (viewport-aware)", () => {
		it("returns all nulls when no screenshots and slots requested", () => {
			const range: TimeRange = { startMs: 0, endMs: 1000 };
			expect(selectScreenshots([], 5, range)).toEqual([
				null,
				null,
				null,
				null,
				null,
			]);
		});

		it("selects screenshots within slot boundaries", () => {
			const screenshots = makeScreenshots(100, 500, 1000, 1500, 2000);
			const range: TimeRange = { startMs: 400, endMs: 1100 };
			const result = selectScreenshots(screenshots, 3, range);
			expect(getTimestamps(result)).toEqual([100, 500, 500]);
		});

		it("uses the frame at the start even when later frames exist within the slot", () => {
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
			const range: TimeRange = { startMs: 0, endMs: 1000 };
			const result = selectScreenshots(screenshots, 2, range);
			expect(getTimestamps(result)).toEqual([0, 500]);
		});

		it("uses earlier screenshot when slot has no screenshots", () => {
			const screenshots = makeScreenshots(100, 200, 800, 900);
			const range: TimeRange = { startMs: 0, endMs: 1000 };
			const result = selectScreenshots(screenshots, 4, range);
			expect(getTimestamps(result)).toEqual([null, 200, 200, 200]);
		});

		it("returns null for slots before any screenshot exists", () => {
			const screenshots = makeScreenshots(500, 600, 700);
			const range: TimeRange = { startMs: 0, endMs: 1000 };
			const result = selectScreenshots(screenshots, 4, range);
			expect(getTimestamps(result)).toEqual([null, null, 500, 700]);
		});

		it("respects causality - never shows future screenshots", () => {
			const screenshots = makeScreenshots(800, 900);
			const range: TimeRange = { startMs: 0, endMs: 1000 };
			const result = selectScreenshots(screenshots, 4, range);
			expect(result[0]).toBeNull();
			expect(result[1]).toBeNull();
			expect(result[2]).toBeNull();
			expect(result[3]).toBeNull();
		});
	});

	describe("zoomed into empty region", () => {
		it("shows closest earlier screenshot when zoomed into gap", () => {
			const screenshots = makeScreenshots(100, 200, 800, 900);
			const range: TimeRange = { startMs: 400, endMs: 600 };
			const result = selectScreenshots(screenshots, 3, range);
			expect(getTimestamps(result)).toEqual([200, 200, 200]);
		});

		it("returns all nulls when zoomed before all screenshots", () => {
			const screenshots = makeScreenshots(500, 600, 700);
			const range: TimeRange = { startMs: 0, endMs: 200 };
			const result = selectScreenshots(screenshots, 3, range);
			expect(getTimestamps(result)).toEqual([null, null, null]);
		});

		it("shows closest earlier when zoomed after all screenshots", () => {
			const screenshots = makeScreenshots(100, 200, 300);
			const range: TimeRange = { startMs: 500, endMs: 1000 };
			const result = selectScreenshots(screenshots, 3, range);
			expect(getTimestamps(result)).toEqual([300, 300, 300]);
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
		it("shows screenshots respecting time boundaries when fully zoomed out", () => {
			const screenshots = makeScreenshots(0, 250, 500, 750, 1000);
			const viewport = createViewport(1000);
			const range = viewportToTimeRange(viewport);
			const result = selectScreenshots(screenshots, 3, range);
			expect(getTimestamps(result)).toEqual([0, 250, 500]);
		});

		it("shows subset and earlier fallbacks when zoomed into a region", () => {
			const screenshots = makeScreenshots(0, 250, 500, 750, 1000);
			const viewport = createViewport(1000);
			const zoomed = zoomToRange(viewport, 200, 600, 0);
			const range = viewportToTimeRange(zoomed);
			const result = selectScreenshots(screenshots, 3, range);
			expect(getTimestamps(result)).toEqual([0, 250, 250]);
		});

		it("shows closest earlier screenshot when zoomed into empty region", () => {
			const screenshots = makeScreenshots(100, 200, 800, 900);
			const viewport = createViewport(1000);
			const zoomed = zoomToRange(viewport, 400, 600, 0);
			const range = viewportToTimeRange(zoomed);
			const result = selectScreenshots(screenshots, 4, range);
			expect(getTimestamps(result)).toEqual([200, 200, 200, 200]);
		});
	});
});
