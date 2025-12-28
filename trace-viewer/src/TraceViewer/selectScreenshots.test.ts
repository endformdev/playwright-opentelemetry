import { describe, expect, it } from "vitest";

import { type Screenshot, selectScreenshots } from "./selectScreenshots";

function makeScreenshots(...timestamps: number[]): Screenshot[] {
	return timestamps.map((timestamp) => ({ timestamp }));
}

function getTimestamps(screenshots: Screenshot[]): number[] {
	return screenshots.map((s) => s.timestamp);
}

describe("selectScreenshots", () => {
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
