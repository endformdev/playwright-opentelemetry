import { describe, expect, it } from "vitest";
import type { RrwebTrace } from "../trace-info-loader";
import type { TimelineViewport } from "./viewport";
import { selectReplayFrames } from "./selectReplayFrames";

const viewport = (
	visibleStartMs: number,
	visibleEndMs: number,
): TimelineViewport => ({
	visibleStartMs,
	visibleEndMs,
	totalDurationMs: visibleEndMs,
});

describe("selectReplayFrames", () => {
	it("returns no frames when there are no recordings", () => {
		expect(
			selectReplayFrames({
				rrweb: { recordings: [] },
				slotCount: 3,
				viewport: viewport(0, 1000),
				testStartTimeMs: 10000,
			}),
		).toEqual([null, null, null]);
	});

	it("selects recording frames at slot centers", () => {
		const rrweb = traceWithRecordings([
			{ id: "page-1", startTime: 10000, endTime: 11000 },
		]);

		const frames = selectReplayFrames({
			rrweb,
			slotCount: 2,
			viewport: viewport(0, 1000),
			testStartTimeMs: 10000,
		});

		expect(frames.map((frame) => frame?.timestamp)).toEqual([10250, 10750]);
		expect(frames.map((frame) => frame?.recording.id)).toEqual([
			"page-1",
			"page-1",
		]);
	});

	it("chooses the recording that contains the slot time", () => {
		const rrweb = traceWithRecordings([
			{ id: "page-1", startTime: 10000, endTime: 10499 },
			{ id: "page-2", startTime: 10500, endTime: 11000 },
		]);

		const frames = selectReplayFrames({
			rrweb,
			slotCount: 2,
			viewport: viewport(0, 1000),
			testStartTimeMs: 10000,
		});

		expect(frames.map((frame) => frame?.recording.id)).toEqual([
			"page-1",
			"page-2",
		]);
	});
});

function traceWithRecordings(
	recordings: Array<{ id: string; startTime: number; endTime: number }>,
): RrwebTrace {
	return {
		recordings: recordings.map((recording) => ({
			...recording,
			pageId: recording.id,
			events: [
				{
					type: 4,
					timestamp: recording.startTime,
					data: { href: "https://example.test", width: 1280, height: 720 },
				},
				{
					type: 2,
					timestamp: recording.startTime + 1,
					data: {
						node: { id: 1, type: 0, childNodes: [] },
						initialOffset: { left: 0, top: 0 },
					},
				},
			],
		})),
	};
}
