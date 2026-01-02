import { describe, expect, it } from "vitest";

import {
	type Screenshot,
	selectScreenshots,
	type SlotScreenshot,
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
			// Screenshots at 1000 and 2000, range is [1000, 2000]
			// Slot 0: [1000, 1250) - contains 1000
			// Slot 1: [1250, 1500) - no screenshot, use earlier (1000)
			// Slot 2: [1500, 1750) - no screenshot, use earlier (1000)
			// Slot 3: [1750, 2000] - contains 2000
			const result = selectScreenshots(makeScreenshots(1000, 2000), 4);
			expect(getTimestamps(result)).toEqual([1000, 1000, 1000, 2000]);
		});

		it("returns all screenshots sorted when count equals slots", () => {
			const result = selectScreenshots(makeScreenshots(3000, 1000, 2000), 3);
			expect(getTimestamps(result)).toEqual([1000, 2000, 3000]);
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
			// Range [0, 9000], 4 slots:
			// Slot 0: [0, 2250) - contains 0, 1000, 2000 -> closest to center (1125) is 1000
			// Slot 1: [2250, 4500) - contains 3000, 4000 -> closest to center (3375) is 3000
			// Slot 2: [4500, 6750) - contains 5000, 6000 -> closest to center (5625) is 6000
			// Slot 3: [6750, 9000] - contains 7000, 8000, 9000 -> closest to center (7875) is 8000
			const result = selectScreenshots(screenshots, 4);
			expect(getTimestamps(result)).toEqual([1000, 3000, 6000, 8000]);
		});

		it("preserves additional properties on screenshots", () => {
			const screenshots = [
				{ timestamp: 1000, url: "a.png" },
				{ timestamp: 2000, url: "b.png" },
			];
			const result = selectScreenshots(screenshots, 4);
			expect(result[0]?.url).toBe("a.png");
			expect(result[3]?.url).toBe("b.png");
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
			// Range [400, 1100], 3 slots:
			// Slot 0: [400, 633.33) - contains 500 -> 500
			// Slot 1: [633.33, 866.67) - no screenshot, earlier is 500
			// Slot 2: [866.67, 1100] - contains 1000 -> 1000
			const range: TimeRange = { startMs: 400, endMs: 1100 };
			const result = selectScreenshots(screenshots, 3, range);
			expect(getTimestamps(result)).toEqual([500, 500, 1000]);
		});

		it("picks closest to center when multiple screenshots in slot", () => {
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
			// Range [0, 1000], 2 slots:
			// Slot 0: [0, 500) - contains 0,100,200,300,400 -> closest to center (250) is 200 or 300
			// Slot 1: [500, 1000] - contains 500,600,700,800,900,1000 -> closest to center (750) is 700 or 800
			const range: TimeRange = { startMs: 0, endMs: 1000 };
			const result = selectScreenshots(screenshots, 2, range);
			// Center of slot 0 is 250, closest is 200 or 300 (both equal distance, first wins)
			// Center of slot 1 is 750, closest is 700 or 800 (both equal distance, first wins)
			expect(result[0]?.timestamp).toBeGreaterThanOrEqual(200);
			expect(result[0]?.timestamp).toBeLessThanOrEqual(300);
			expect(result[1]?.timestamp).toBeGreaterThanOrEqual(700);
			expect(result[1]?.timestamp).toBeLessThanOrEqual(800);
		});

		it("uses earlier screenshot when slot has no screenshots", () => {
			const screenshots = makeScreenshots(100, 200, 800, 900);
			// Range [0, 1000], 4 slots:
			// Slot 0: [0, 250) - contains 100, 200 -> closest to center (125) is 100
			// Slot 1: [250, 500) - no screenshots, earlier is 200
			// Slot 2: [500, 750) - no screenshots, earlier is 200
			// Slot 3: [750, 1000] - contains 800, 900 -> closest to center (875) is 900
			const range: TimeRange = { startMs: 0, endMs: 1000 };
			const result = selectScreenshots(screenshots, 4, range);
			expect(getTimestamps(result)).toEqual([100, 200, 200, 900]);
		});

		it("returns null for slots before any screenshot exists", () => {
			const screenshots = makeScreenshots(500, 600, 700);
			// Range [0, 1000], 4 slots:
			// Slot 0: [0, 250) - no screenshots, no earlier -> null
			// Slot 1: [250, 500) - no screenshots, no earlier -> null
			// Slot 2: [500, 750) - contains 500, 600, 700 -> closest to center (625) is 600
			// Slot 3: [750, 1000] - no screenshots, earlier is 700
			const range: TimeRange = { startMs: 0, endMs: 1000 };
			const result = selectScreenshots(screenshots, 4, range);
			expect(getTimestamps(result)).toEqual([null, null, 600, 700]);
		});

		it("respects causality - never shows future screenshots", () => {
			const screenshots = makeScreenshots(800, 900);
			// Range [0, 1000], 4 slots:
			// Slots 0, 1, 2 should be null (no earlier screenshots)
			// Slot 3 contains 800, 900
			const range: TimeRange = { startMs: 0, endMs: 1000 };
			const result = selectScreenshots(screenshots, 4, range);
			expect(result[0]).toBeNull();
			expect(result[1]).toBeNull();
			expect(result[2]).toBeNull();
			expect(result[3]).not.toBeNull();
		});
	});

	describe("zoomed into empty region", () => {
		it("shows closest earlier screenshot when zoomed into gap", () => {
			const screenshots = makeScreenshots(100, 200, 800, 900);
			// Range [400, 600] - no screenshots in range
			// Closest before range is 200
			const range: TimeRange = { startMs: 400, endMs: 600 };
			const result = selectScreenshots(screenshots, 3, range);
			expect(getTimestamps(result)).toEqual([200, 200, 200]);
		});

		it("returns all nulls when zoomed before all screenshots", () => {
			const screenshots = makeScreenshots(500, 600, 700);
			// Range [0, 200] - before all screenshots
			const range: TimeRange = { startMs: 0, endMs: 200 };
			const result = selectScreenshots(screenshots, 3, range);
			expect(getTimestamps(result)).toEqual([null, null, null]);
		});

		it("shows closest earlier when zoomed after all screenshots", () => {
			const screenshots = makeScreenshots(100, 200, 300);
			// Range [500, 1000] - after all screenshots
			// Closest before is 300
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
			// 3 slots over [0, 1000]:
			// Slot 0: [0, 333.33) - contains 0, 250 -> closest to center (166.67) is 250
			// Slot 1: [333.33, 666.67) - contains 500 -> 500
			// Slot 2: [666.67, 1000] - contains 750, 1000 -> closest to center (833.33) is 750
			const result = selectScreenshots(screenshots, 3, range);
			expect(getTimestamps(result)).toEqual([250, 500, 750]);
		});

		it("shows subset and earlier fallbacks when zoomed into a region", () => {
			const screenshots = makeScreenshots(0, 250, 500, 750, 1000);
			const viewport = createViewport(1000);
			const zoomed = zoomToRange(viewport, 200, 600, 0);
			const range = viewportToTimeRange(zoomed);
			// Range [200, 600], 3 slots:
			// Slot 0: [200, 333.33) - contains 250 -> 250
			// Slot 1: [333.33, 466.67) - no screenshots, earlier is 250
			// Slot 2: [466.67, 600] - contains 500 -> 500
			const result = selectScreenshots(screenshots, 3, range);
			expect(getTimestamps(result)).toEqual([250, 250, 500]);
		});

		it("shows closest earlier screenshot when zoomed into empty region", () => {
			const screenshots = makeScreenshots(100, 200, 800, 900);
			const viewport = createViewport(1000);
			// Zoom into region with no screenshots
			const zoomed = zoomToRange(viewport, 400, 600, 0);
			const range = viewportToTimeRange(zoomed);
			const result = selectScreenshots(screenshots, 4, range);
			// All slots should show 200 (closest before range)
			expect(getTimestamps(result)).toEqual([200, 200, 200, 200]);
		});
	});
});
