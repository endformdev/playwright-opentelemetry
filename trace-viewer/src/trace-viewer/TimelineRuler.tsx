import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";

import { calculateTimelineScale, type TimelineTick } from "./timelineScale";
import {
	isFullyZoomedOut,
	type TimelineViewport,
	timeToTotalPosition,
	viewportPositionToTime,
} from "./viewport";

export interface TimelineRulerProps {
	/** Duration in milliseconds */
	durationMs: number;
	/** Current viewport state for showing the visible region indicator */
	viewport: TimelineViewport;
	/** Current hover position in viewport space (0-1), or null if not hovering */
	hoverPosition: number | null;
}

/**
 * A fixed-height timeline ruler showing time divisions.
 * Automatically adapts the number and spacing of tick marks based on available width.
 * When zoomed, shows an overlay indicating the currently visible region.
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

	// Calculate viewport indicator positions (as percentages of total timeline)
	const viewportStartPercent = () =>
		timeToTotalPosition(props.viewport.visibleStartMs, props.viewport) * 100;
	const viewportEndPercent = () =>
		timeToTotalPosition(props.viewport.visibleEndMs, props.viewport) * 100;
	const viewportWidthPercent = () =>
		viewportEndPercent() - viewportStartPercent();

	// Calculate hover position on the total timeline (not viewport)
	// Convert from viewport space (0-1) to absolute time, then to total position
	const hoverPositionOnTotal = () => {
		if (props.hoverPosition === null) return null;
		const timeMs = viewportPositionToTime(props.hoverPosition, props.viewport);
		return timeToTotalPosition(timeMs, props.viewport) * 100;
	};

	return (
		<div
			ref={containerRef}
			class="relative h-6 bg-gray-50 border-b border-gray-200 flex-shrink-0"
		>
			{/* Viewport indicator overlay - shows when zoomed in */}
			<Show when={!isFullyZoomedOut(props.viewport)}>
				{/* Dimmed areas outside viewport */}
				<div
					class="absolute top-0 bottom-0 bg-gray-300/30 pointer-events-none"
					style={{
						left: "0%",
						width: `${viewportStartPercent()}%`,
					}}
				/>
				<div
					class="absolute top-0 bottom-0 bg-gray-300/30 pointer-events-none"
					style={{
						left: `${viewportEndPercent()}%`,
						right: "0%",
					}}
				/>
				{/* Highlighted visible region border */}
				<div
					class="absolute top-0 bottom-0 border-x-2 border-blue-500/50 pointer-events-none"
					style={{
						left: `${viewportStartPercent()}%`,
						width: `${viewportWidthPercent()}%`,
					}}
				/>
			</Show>

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

			{/* Hover indicator on total timeline */}
			<Show when={hoverPositionOnTotal()} keyed>
				{(pos) => (
					<div
						class="absolute top-0 bottom-0 w-px bg-blue-500 pointer-events-none z-50"
						style={{ left: `${pos}%` }}
					/>
				)}
			</Show>
		</div>
	);
}
