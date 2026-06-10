import { Replayer } from "@rrweb/replay";
import { createEffect, onCleanup } from "solid-js";
import type { RrwebRecording } from "../../trace-info-loader";
import {
	recordingDimensions,
	replayOffsetMs,
	scaleReplayerToContainer,
} from "./useRrwebRecording";

export interface RrwebThumbnailProps {
	recording: RrwebRecording;
	absoluteTimeMs: number;
}

export function RrwebThumbnail(props: RrwebThumbnailProps) {
	let containerRef: HTMLDivElement | undefined;
	let replayer: Replayer | null = null;
	let cleanupScale: (() => void) | undefined;

	const destroyReplayer = () => {
		cleanupScale?.();
		cleanupScale = undefined;
		replayer?.destroy();
		replayer = null;
		if (containerRef) {
			containerRef.textContent = "";
		}
	};

	createEffect(() => {
		if (!containerRef) return;
		destroyReplayer();
		replayer = new Replayer(props.recording.events, {
			root: containerRef,
			UNSAFE_replayCanvas: true,
			mouseTail: false,
		} as ConstructorParameters<typeof Replayer>[1]);
		cleanupScale = scaleReplayerToContainer(
			replayer,
			containerRef,
			recordingDimensions(props.recording),
		);
		replayer.pause(replayOffsetMs(props.recording, props.absoluteTimeMs));

		onCleanup(destroyReplayer);
	});

	onCleanup(destroyReplayer);

	return (
		<div
			ref={containerRef}
			data-testid="rrweb-thumbnail"
			class="rrweb-replay-container h-full w-full bg-white overflow-hidden"
		/>
	);
}
