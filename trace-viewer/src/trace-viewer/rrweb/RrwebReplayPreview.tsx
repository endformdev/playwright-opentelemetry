import { Replayer } from "@rrweb/replay";
import { createEffect, createMemo, onCleanup, Show } from "solid-js";
import type { RrwebTrace } from "../../trace-info-loader";
import {
	recordingDimensions,
	replayOffsetMs,
	scaleReplayerToContainer,
	selectRecordingAtTime,
} from "./useRrwebRecording";

export interface RrwebReplayPreviewProps {
	rrweb: RrwebTrace;
	absoluteTimeMs: number | null;
}

export function RrwebReplayPreview(props: RrwebReplayPreviewProps) {
	let containerRef: HTMLDivElement | undefined;
	let replayer: Replayer | null = null;
	let animationFrame: number | undefined;
	let cleanupScale: (() => void) | undefined;

	const recording = createMemo(() => {
		const absoluteTimeMs = props.absoluteTimeMs;
		return absoluteTimeMs === null
			? null
			: selectRecordingAtTime(props.rrweb, absoluteTimeMs);
	});

	const destroyReplayer = () => {
		cleanupScale?.();
		cleanupScale = undefined;
		if (animationFrame !== undefined) {
			cancelAnimationFrame(animationFrame);
			animationFrame = undefined;
		}
		replayer?.destroy();
		replayer = null;
		if (containerRef) {
			containerRef.textContent = "";
		}
	};

	createEffect(() => {
		const currentRecording = recording();
		if (!containerRef || !currentRecording) {
			destroyReplayer();
			return;
		}

		destroyReplayer();
		replayer = new Replayer(currentRecording.events, {
			root: containerRef,
			UNSAFE_replayCanvas: true,
			mouseTail: false,
		} as ConstructorParameters<typeof Replayer>[1]);
		cleanupScale = scaleReplayerToContainer(
			replayer,
			containerRef,
			recordingDimensions(currentRecording),
		);
		if (props.absoluteTimeMs !== null) {
			replayer.pause(replayOffsetMs(currentRecording, props.absoluteTimeMs));
		}

		onCleanup(destroyReplayer);
	});

	createEffect(() => {
		const currentRecording = recording();
		const absoluteTimeMs = props.absoluteTimeMs;
		if (!replayer || !currentRecording || absoluteTimeMs === null) return;

		if (animationFrame !== undefined) {
			cancelAnimationFrame(animationFrame);
		}
		animationFrame = requestAnimationFrame(() => {
			animationFrame = undefined;
			replayer?.pause(replayOffsetMs(currentRecording, absoluteTimeMs));
		});
	});

	onCleanup(destroyReplayer);

	return (
		<div class="rounded-md border border-gray-200 bg-gray-950 overflow-hidden">
			<div class="px-3 py-2 text-xs font-semibold text-gray-200 uppercase tracking-wide bg-gray-900">
				Page Replay
			</div>
			<Show
				when={props.absoluteTimeMs !== null}
				fallback={
					<div class="aspect-video flex items-center justify-center text-gray-400 text-sm bg-gray-950">
						Hover over the timeline to replay
					</div>
				}
			>
				<Show
					when={recording()}
					fallback={
						<div class="aspect-video flex items-center justify-center text-gray-400 text-sm bg-gray-950">
							No rrweb recording was captured during this test
						</div>
					}
				>
					<div
						ref={containerRef}
						data-testid="rrweb-replay-preview"
						class="rrweb-replay-container rrweb-replay-preview bg-white aspect-video overflow-hidden"
					/>
				</Show>
			</Show>
		</div>
	);
}
