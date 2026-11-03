import { describe, expect, it } from "vitest";
import {
	advancePlayback,
	followPlayhead,
	formatPlaybackSpeed,
	getPlaybackStartMs,
	MAX_PLAYBACK_FRAME_MS,
	nextPlaybackSpeed,
} from "./playback";
import type { TimelineViewport } from "./viewport";

function viewport(
	visibleStartMs: number,
	visibleEndMs: number,
	totalDurationMs = 10_000,
): TimelineViewport {
	return { visibleStartMs, visibleEndMs, totalDurationMs };
}

describe("nextPlaybackSpeed", () => {
	it("cycles from normal speed to double, half and back", () => {
		expect(nextPlaybackSpeed(1)).toBe(2);
		expect(nextPlaybackSpeed(2)).toBe(0.5);
		expect(nextPlaybackSpeed(0.5)).toBe(1);
	});
});

describe("formatPlaybackSpeed", () => {
	it("writes speeds as multipliers", () => {
		expect(formatPlaybackSpeed(0.5)).toBe("0.5×");
		expect(formatPlaybackSpeed(1)).toBe("1×");
		expect(formatPlaybackSpeed(2)).toBe("2×");
	});
});

describe("getPlaybackStartMs", () => {
	it("starts from the locked time", () => {
		expect(getPlaybackStartMs(1200, viewport(1000, 3000), 10_000)).toBe(1200);
	});

	it("starts from the start of the view with nothing locked", () => {
		expect(getPlaybackStartMs(null, viewport(1000, 3000), 10_000)).toBe(1000);
	});

	it("starts over from the very end", () => {
		expect(getPlaybackStartMs(10_000, viewport(8000, 10_000), 10_000)).toBe(0);
	});
});

describe("advancePlayback", () => {
	it("advances by real time scaled by speed", () => {
		expect(advancePlayback(1000, 16, 1, 10_000)).toBe(1016);
		expect(advancePlayback(1000, 16, 2, 10_000)).toBe(1032);
		expect(advancePlayback(1000, 16, 0.5, 10_000)).toBe(1008);
	});

	it("stops at the end", () => {
		expect(advancePlayback(9990, 50, 2, 10_000)).toBe(10_000);
	});

	it("does not jump ahead after a stalled frame", () => {
		expect(advancePlayback(1000, 5000, 1, 10_000)).toBe(
			1000 + MAX_PLAYBACK_FRAME_MS,
		);
	});
});

describe("followPlayhead", () => {
	it("leaves the view alone while the playhead is comfortably in it", () => {
		expect(followPlayhead(viewport(1000, 3000), 2000)).toBeNull();
	});

	it("pages along once the playhead nears the right edge", () => {
		expect(followPlayhead(viewport(1000, 3000), 2900)).toEqual(
			viewport(2700, 4700),
		);
	});

	it("brings an out of view playhead back into view", () => {
		expect(followPlayhead(viewport(1000, 3000), 500)).toEqual(
			viewport(300, 2300),
		);
	});

	it("stays put once pinned against the end of the trace", () => {
		expect(followPlayhead(viewport(8000, 10_000), 9900)).toBeNull();
	});

	it("never needs to move a fully zoomed out view", () => {
		expect(followPlayhead(viewport(0, 10_000), 9900)).toBeNull();
	});
});
