import { createEffect, createSignal, For, onCleanup } from "solid-js";

import { calculateTimelineScale, type TimelineTick } from "./timelineScale";

export interface TimelineRulerProps {
	/** Duration in milliseconds */
	durationMs: number;
}

/**
 * A fixed-height timeline ruler showing time divisions.
 * Automatically adapts the number and spacing of tick marks based on available width.
 */
export function TimelineRuler(props: TimelineRulerProps) {
	let containerRef: HTMLDivElement | undefined;

	const [ticks, setTicks] = createSignal<TimelineTick[]>([]);

	// Set up ResizeObserver to recalculate ticks when width changes
	createEffect(() => {
		if (!containerRef) return;

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const width = entry.contentRect.width;
				if (width > 0) {
					const scale = calculateTimelineScale(props.durationMs, width);
					setTicks(scale.ticks);
				}
			}
		});

		resizeObserver.observe(containerRef);

		onCleanup(() => {
			resizeObserver.disconnect();
		});
	});

	// Recalculate when duration changes
	createEffect(() => {
		if (containerRef) {
			const width = containerRef.getBoundingClientRect().width;
			if (width > 0) {
				const scale = calculateTimelineScale(props.durationMs, width);
				setTicks(scale.ticks);
			}
		}
	});

	return (
		<div
			ref={containerRef}
			class="relative h-6 bg-gray-50 border-b border-gray-200 flex-shrink-0"
		>
			{/* Tick marks and labels */}
			<For each={ticks()}>
				{(tick, index) => {
					const isLast = () => index() === ticks().length - 1;

					return (
						<div
							class="absolute top-0 bottom-0 flex items-center"
							style={{
								left: `${tick.position * 100}%`,
							}}
						>
							{/* Vertical tick line - almost full height */}
							<div class="w-px h-5 bg-gray-300" />

							{/* Label - to the right of the tick, except for last tick */}
							<span
								class="text-[10px] text-gray-500 whitespace-nowrap pl-1"
								style={{
									position: isLast() ? "absolute" : "relative",
									right: isLast() ? "1px" : undefined,
								}}
							>
								{tick.label}
							</span>
						</div>
					);
				}}
			</For>
		</div>
	);
}
