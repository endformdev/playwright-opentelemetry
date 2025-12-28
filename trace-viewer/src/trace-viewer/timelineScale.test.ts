import { describe, expect, it } from "vitest";

import {
	calculateTimelineScale,
	formatTimeLabel,
	generateTicks,
} from "./timelineScale";

describe("formatTimeLabel", () => {
	it("formats time values correctly across ranges", () => {
		expect(formatTimeLabel(0)).toBe("0s");
		expect(formatTimeLabel(500)).toBe("500ms");
		expect(formatTimeLabel(1000)).toBe("1s");
		expect(formatTimeLabel(1500)).toBe("1.5s");
		expect(formatTimeLabel(60000)).toBe("1m");
		expect(formatTimeLabel(90000)).toBe("1m 30s");
	});
});

describe("generateTicks", () => {
	it("generates ticks at regular intervals with correct positions", () => {
		const ticks = generateTicks(10000, 5000);
		expect(ticks).toHaveLength(3);
		expect(ticks.map((t) => t.timeMs)).toEqual([0, 5000, 10000]);
		expect(ticks.map((t) => t.position)).toEqual([0, 0.5, 1]);
	});

	it("replaces last tick with end tick when close to avoid overlap", () => {
		// 7s with 2s intervals: last regular tick at 6s is within 50% of interval from end
		const ticks = generateTicks(7000, 2000);
		expect(ticks.map((t) => t.timeMs)).toEqual([0, 2000, 4000, 7000]);
	});

	it("keeps last regular tick when end is more than 50% away", () => {
		// 9.2s with 2s intervals: 1.2s gap is > 50% of 2s interval
		const ticks = generateTicks(9200, 2000);
		expect(ticks.map((t) => t.timeMs)).toEqual([
			0, 2000, 4000, 6000, 8000, 9200,
		]);
	});
});

describe("calculateTimelineScale", () => {
	it("selects appropriate interval based on width constraints", () => {
		// 10s test, 500px width -> 2s interval (1s would give too many ticks)
		const scale = calculateTimelineScale(10000, 500);
		expect(scale.intervalMs).toBe(2000);
		expect(scale.ticks.map((t) => t.timeMs)).toEqual([
			0, 2000, 4000, 6000, 8000, 10000,
		]);
	});

	it("adapts to narrow widths", () => {
		// 10s test, 150px width -> needs larger interval
		const scale = calculateTimelineScale(10000, 150);
		expect(scale.intervalMs).toBe(5000);
		expect(scale.ticks.map((t) => t.timeMs)).toEqual([0, 5000, 10000]);
	});

	it("handles short durations with millisecond labels", () => {
		const scale = calculateTimelineScale(500, 300);
		expect(scale.intervalMs).toBe(100);
		expect(scale.ticks[0].label).toBe("0s");
		expect(scale.ticks[1].label).toBe("100ms");
	});

	it("handles long durations with minute labels", () => {
		const scale = calculateTimelineScale(120000, 500);
		expect(scale.ticks[0].label).toBe("0s");
		expect(scale.ticks[scale.ticks.length - 1].label).toBe("2m");
	});
});
