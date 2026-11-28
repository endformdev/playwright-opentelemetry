import { describe, expect, it } from "vitest";
import {
	advancePlayback,
	followPlayhead,
	formatPlaybackSpeed,
	getDefaultPlaybackSpeed,
	getHeldPlayback,
	getPlaybackStartMs,
	isPlaybackOver,
	MAX_PLAYBACK_FRAME_MS,
	nextPlaybackSpeed,
	type PlaybackPosition,
	type PlaybackSpeed,
	rejoinPlayback,
	startPlayback,
} from "./playback";
import { createViewport, type TimelineViewport } from "./viewport";

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

describe("getDefaultPlaybackSpeed", () => {
	it("is real time, or double when playback holds on the actions", () => {
		expect(getDefaultPlaybackSpeed(false)).toBe(1);
		expect(getDefaultPlaybackSpeed(true)).toBe(2);
	});
});

describe("advancePlayback", () => {
	it("advances by real time scaled by speed", () => {
		expect(advancePlayback(startPlayback(1000), 16, 1, 10_000).timeMs).toBe(
			1016,
		);
		expect(advancePlayback(startPlayback(1000), 16, 2, 10_000).timeMs).toBe(
			1032,
		);
		expect(advancePlayback(startPlayback(1000), 16, 0.5, 10_000).timeMs).toBe(
			1008,
		);
	});

	it("stops at the end", () => {
		const position = advancePlayback(startPlayback(9990), 50, 2, 10_000);
		expect(position.timeMs).toBe(10_000);
		expect(isPlaybackOver(position, [], 10_000)).toBe(true);
	});

	it("does not jump ahead after a stalled frame", () => {
		expect(advancePlayback(startPlayback(1000), 5000, 1, 10_000).timeMs).toBe(
			1000 + MAX_PLAYBACK_FRAME_MS,
		);
	});
});

describe("playback holds", () => {
	const holds = [
		{ timeMs: 1000, durationMs: 300 },
		{ timeMs: 1010, durationMs: 200 },
		{ timeMs: 5000, durationMs: 100 },
	];
	/** Plays on in frames of 20 ms, giving the time after each. */
	const play = (
		from: PlaybackPosition,
		frames: number,
		speed: PlaybackSpeed = 1,
	) => {
		const times: number[] = [];
		let position = from;
		for (let frame = 0; frame < frames; frame++) {
			position = advancePlayback(position, 20, speed, 10_000, holds);
			times.push(position.timeMs);
		}
		return { position, times };
	};

	it("stops at a hold and waits there", () => {
		const { position, times } = play(startPlayback(960, holds), 5);
		expect(times).toEqual([980, 1000, 1000, 1000, 1000]);
		expect(getHeldPlayback(position, holds, 10_000)).toEqual({
			index: 0,
			heldMs: 60,
		});
	});

	it("isn't waiting while it moves", () => {
		const position = advancePlayback(startPlayback(900, holds), 20, 1, 10_000);
		expect(getHeldPlayback(position, holds, 10_000)).toBeNull();
	});

	it("moves on once the hold is over, into the next one", () => {
		// 300 ms on the first hold, 10 ms to the second, 200 ms there.
		const { times } = play(startPlayback(1000, holds), 27);
		expect(times.slice(0, 15).every((timeMs) => timeMs === 1000)).toBe(true);
		expect(times.slice(15, 25).every((timeMs) => timeMs === 1010)).toBe(true);
		// Half of that frame was left once the second hold was over.
		expect(times[25]).toBe(1020);
		expect(times[26]).toBe(1040);
	});

	it("waits as long at any speed", () => {
		const waited = (speed: PlaybackSpeed) =>
			play(startPlayback(1000, holds), 40, speed).times.filter(
				(timeMs) => timeMs === 1000,
			).length;
		expect(waited(2)).toBe(waited(0.5));
		expect(waited(2)).toBe(15);
	});

	it("spends what is left of a frame after a hold on moving", () => {
		const held = { timeMs: 5000, nextHold: 2, heldMs: 90 };
		expect(advancePlayback(held, 30, 2, 10_000, holds)).toEqual({
			timeMs: 5040,
			nextHold: 3,
			heldMs: 0,
		});
	});

	it("waits at a hold it starts on, and leaves earlier ones behind", () => {
		expect(startPlayback(1010, holds)).toEqual({
			timeMs: 1010,
			nextHold: 1,
			heldMs: 0,
		});
		expect(startPlayback(6000, holds).nextHold).toBe(3);
	});

	it("rejoins without waiting where it already is", () => {
		expect(rejoinPlayback(1000, holds).nextHold).toBe(1);
		expect(rejoinPlayback(999, holds).nextHold).toBe(0);
	});

	it("isn't over until a hold at the very end is", () => {
		const atEnd = [{ timeMs: 10_000, durationMs: 100 }];
		let position = advancePlayback(
			startPlayback(9990, atEnd),
			20,
			1,
			10_000,
			atEnd,
		);
		expect(position.timeMs).toBe(10_000);
		expect(isPlaybackOver(position, atEnd, 10_000)).toBe(false);
		position = advancePlayback(position, 100, 1, 10_000, atEnd);
		expect(isPlaybackOver(position, atEnd, 10_000)).toBe(true);
	});

	it("leaves out holds past the end", () => {
		const late = [{ timeMs: 12_000, durationMs: 100 }];
		const position = advancePlayback(
			startPlayback(9990, late),
			50,
			1,
			10_000,
			late,
		);
		expect(position.timeMs).toBe(10_000);
		expect(isPlaybackOver(position, late, 10_000)).toBe(true);
	});
});

describe("followPlayhead", () => {
	it("has nowhere to go when fully zoomed out", () => {
		const fullyZoomedOut = createViewport(10_000);
		for (let timeMs = 9000; timeMs <= 10_000; timeMs += 16.67) {
			expect(followPlayhead(fullyZoomedOut, timeMs)).toBeNull();
		}
	});

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
