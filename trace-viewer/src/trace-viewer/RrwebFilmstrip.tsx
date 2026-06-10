import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";
import type { RrwebTrace } from "../trace-info-loader";
import { RrwebThumbnail } from "./rrweb/RrwebThumbnail";
import { selectReplayFrames } from "./selectReplayFrames";
import type { TimelineViewport } from "./viewport";

export interface RrwebFilmstripProps {
	rrweb: RrwebTrace;
	viewport: TimelineViewport;
	testStartTimeMs: number;
	onReplayFrameHover?: (
		frame: { id: string; timestamp: number } | null,
	) => void;
}

const MAX_RRWEB_FILMSTRIP_REPLAYERS = 6;

export function RrwebFilmstrip(props: RrwebFilmstripProps) {
	let contentRef: HTMLDivElement | undefined;
	const [slotCount, setSlotCount] = createSignal(0);

	createEffect(() => {
		if (!contentRef) return;

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const height = entry.contentRect.height;
				const width = entry.contentRect.width;
				if (height <= 0 || width <= 0) continue;

				const availableHeight = height - 16;
				const thumbnailHeight = availableHeight;
				const thumbnailWidth = thumbnailHeight * (16 / 9);
				const gap = 8;
				const count = Math.floor((width + gap) / (thumbnailWidth + gap));
				setSlotCount(
					Math.max(0, Math.min(MAX_RRWEB_FILMSTRIP_REPLAYERS, count)),
				);
			}
		});

		resizeObserver.observe(contentRef);
		onCleanup(() => resizeObserver.disconnect());
	});

	const frames = createMemo(() =>
		selectReplayFrames({
			rrweb: props.rrweb,
			slotCount: slotCount(),
			viewport: props.viewport,
			testStartTimeMs: props.testStartTimeMs,
		}),
	);

	const hasAnyFrames = createMemo(() =>
		frames().some((frame) => frame !== null),
	);

	return (
		<div
			ref={contentRef}
			class="h-full bg-gray-50 overflow-hidden p-2"
			role="region"
			aria-label="Replay"
		>
			<div class="flex gap-2 h-full">
				<Show
					when={slotCount() > 0}
					fallback={
						<div class="flex items-center justify-center w-full text-gray-400 text-sm">
							Resize panel to view replay
						</div>
					}
				>
					<Show
						when={hasAnyFrames()}
						fallback={
							<div class="flex items-center justify-center w-full text-gray-400 text-sm">
								No rrweb recording in this time range
							</div>
						}
					>
						<For each={frames()}>
							{(frame, index) => (
								<Show
									when={frame}
									fallback={<div class="flex-shrink-0 h-full aspect-video" />}
								>
									{(currentFrame) => {
										const frameId = () =>
											`${currentFrame().recording.id}:${currentFrame().timestamp}:${index()}`;
										const notifyFrameHover = () =>
											props.onReplayFrameHover?.({
												id: frameId(),
												timestamp: currentFrame().timestamp,
											});
										return (
											<div
												class="relative flex-shrink-0 h-full aspect-video bg-white rounded border border-gray-200 overflow-hidden shadow-sm"
												data-replay-frame-timestamp={currentFrame().timestamp}
											>
												<RrwebThumbnail
													recording={currentFrame().recording}
													absoluteTimeMs={currentFrame().timestamp}
												/>
												<div
													class="absolute inset-0"
													onMouseEnter={notifyFrameHover}
													onMouseMove={notifyFrameHover}
													onMouseLeave={() => props.onReplayFrameHover?.(null)}
												/>
											</div>
										);
									}}
								</Show>
							)}
						</For>
					</Show>
				</Show>
			</div>
		</div>
	);
}
