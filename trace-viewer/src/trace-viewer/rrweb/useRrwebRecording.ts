import { EventType } from "@rrweb/types";
import type { RrwebRecording, RrwebTrace } from "../../trace-info-loader";

export interface RrwebRecordingDimensions {
	width: number;
	height: number;
}

export function selectRecordingAtTime(
	rrweb: RrwebTrace,
	absoluteTimeMs: number,
): RrwebRecording | null {
	const playable = rrweb.recordings.filter(isPlayableRecording);
	if (playable.length === 0) return null;

	const containing = playable.filter(
		(recording) =>
			absoluteTimeMs >= recording.startTime &&
			absoluteTimeMs <= recording.endTime,
	);
	if (containing.length > 0) {
		return containing.sort((a, b) => a.startTime - b.startTime)[0];
	}

	return playable.sort((a, b) => a.startTime - b.startTime)[0];
}

export function isPlayableRecording(recording: RrwebRecording): boolean {
	return (
		recording.events.some((event) => event.type === EventType.Meta) &&
		recording.events.some((event) => event.type === EventType.FullSnapshot)
	);
}

export function replayOffsetMs(
	recording: RrwebRecording,
	absoluteTimeMs: number,
): number {
	return Math.max(
		0,
		Math.min(
			recording.endTime - recording.startTime,
			absoluteTimeMs - recording.startTime,
		),
	);
}

export function recordingDimensions(
	recording: RrwebRecording,
): RrwebRecordingDimensions | null {
	const meta = recording.events.find((event) => event.type === EventType.Meta);
	if (!meta || meta.type !== EventType.Meta) return null;
	if (meta.data.width <= 0 || meta.data.height <= 0) return null;
	return { width: meta.data.width, height: meta.data.height };
}

export function scaleReplayerToContainer(
	replayer: { wrapper: HTMLDivElement },
	container: HTMLElement,
	dimensions: RrwebRecordingDimensions | null,
) {
	if (!dimensions) return;

	const { width, height } = dimensions;
	replayer.wrapper.style.width = `${width}px`;
	replayer.wrapper.style.height = `${height}px`;
	replayer.wrapper.style.transformOrigin = "top left";

	const updateScale = () => {
		const containerWidth = container.clientWidth;
		const containerHeight = container.clientHeight;
		if (containerWidth <= 0 || containerHeight <= 0) return;

		const scale = Math.min(containerWidth / width, containerHeight / height);
		replayer.wrapper.style.transform = `scale(${scale})`;
	};

	updateScale();
	const observer = new ResizeObserver(updateScale);
	observer.observe(container);
	return () => observer.disconnect();
}
