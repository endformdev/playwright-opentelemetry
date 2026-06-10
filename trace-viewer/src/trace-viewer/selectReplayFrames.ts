import type { RrwebRecording, RrwebTrace } from "../trace-info-loader";
import type { TimelineViewport } from "./viewport";
import { selectRecordingAtTime } from "./rrweb/useRrwebRecording";

export interface ReplayFrame {
	timestamp: number;
	recording: RrwebRecording;
}

export function selectReplayFrames({
	rrweb,
	slotCount,
	viewport,
	testStartTimeMs,
}: {
	rrweb: RrwebTrace;
	slotCount: number;
	viewport: TimelineViewport;
	testStartTimeMs: number;
}): Array<ReplayFrame | null> {
	if (slotCount <= 0) return [];
	if (rrweb.recordings.length === 0) return Array(slotCount).fill(null);

	const rangeMs = viewport.visibleEndMs - viewport.visibleStartMs;
	if (rangeMs <= 0) {
		const absoluteTimeMs = testStartTimeMs + viewport.visibleStartMs;
		const recording = selectRecordingAtTime(rrweb, absoluteTimeMs);
		return Array(slotCount).fill(
			recording ? { timestamp: absoluteTimeMs, recording } : null,
		);
	}

	const slotWidthMs = rangeMs / slotCount;
	return Array.from({ length: slotCount }, (_, index) => {
		const relativeTimeMs =
			viewport.visibleStartMs + slotWidthMs * (index + 0.5);
		const absoluteTimeMs = testStartTimeMs + relativeTimeMs;
		const recording = selectRecordingAtTime(rrweb, absoluteTimeMs);
		return recording ? { timestamp: absoluteTimeMs, recording } : null;
	});
}
