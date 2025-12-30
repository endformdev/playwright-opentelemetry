import {
	createEffect,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";

import { calculateTimelineScale, type TimelineTick } from "./timelineScale";
import {
	clampViewport,
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
	/** Callback when viewport is adjusted via handle drag or pan */
	onViewportChange?: (newViewport: TimelineViewport) => void;
}

/** Minimum viewport width as percentage of total duration */
const MIN_VIEWPORT_WIDTH_PERCENT = 0.01;

type RulerDragMode = "left-handle" | "right-handle" | "pan";

interface RulerDragState {
	mode: RulerDragMode;
	startMouseX: number;
	containerWidth: number;
	initialViewport: TimelineViewport;
}

/**
 * A fixed-height timeline ruler showing time divisions.
 * Automatically adapts the number and spacing of tick marks based on available width.
 * When zoomed, shows an overlay indicating the currently visible region with draggable handles.
 */
export function TimelineRuler(props: TimelineRulerProps) {
	let containerRef: HTMLDivElement | undefined;

	const [ticks, setTicks] = createSignal<TimelineTick[]>([]);
	const [dragState, setDragState] = createSignal<RulerDragState | null>(null);

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

	// Handle drag start on handles or viewport center
	const handleMouseDown = (mode: RulerDragMode) => (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();

		if (!containerRef) return;

		const containerWidth = containerRef.getBoundingClientRect().width;

		setDragState({
			mode,
			startMouseX: e.clientX,
			containerWidth,
			initialViewport: { ...props.viewport },
		});
	};

	// Handle drag movement
	const handleMouseMove = (e: MouseEvent) => {
		const state = dragState();
		if (!state || !props.onViewportChange) return;

		const deltaX = e.clientX - state.startMouseX;
		const deltaPercent = deltaX / state.containerWidth;
		const deltaMsTotal = deltaPercent * state.initialViewport.totalDurationMs;

		let newViewport: TimelineViewport;

		switch (state.mode) {
			case "left-handle": {
				// Move left edge, keep right edge fixed
				const newStart = state.initialViewport.visibleStartMs + deltaMsTotal;
				const minStart = 0;
				const maxStart =
					state.initialViewport.visibleEndMs -
					state.initialViewport.totalDurationMs * MIN_VIEWPORT_WIDTH_PERCENT;

				newViewport = {
					...state.initialViewport,
					visibleStartMs: Math.max(minStart, Math.min(maxStart, newStart)),
				};
				break;
			}

			case "right-handle": {
				// Move right edge, keep left edge fixed
				const newEnd = state.initialViewport.visibleEndMs + deltaMsTotal;
				const minEnd =
					state.initialViewport.visibleStartMs +
					state.initialViewport.totalDurationMs * MIN_VIEWPORT_WIDTH_PERCENT;
				const maxEnd = state.initialViewport.totalDurationMs;

				newViewport = {
					...state.initialViewport,
					visibleEndMs: Math.max(minEnd, Math.min(maxEnd, newEnd)),
				};
				break;
			}

			case "pan": {
				// Move both edges by the same amount
				const visibleDuration =
					state.initialViewport.visibleEndMs -
					state.initialViewport.visibleStartMs;
				let newStart = state.initialViewport.visibleStartMs + deltaMsTotal;
				let newEnd = state.initialViewport.visibleEndMs + deltaMsTotal;

				// Clamp to bounds
				if (newStart < 0) {
					newStart = 0;
					newEnd = visibleDuration;
				}
				if (newEnd > state.initialViewport.totalDurationMs) {
					newEnd = state.initialViewport.totalDurationMs;
					newStart = newEnd - visibleDuration;
				}

				newViewport = {
					...state.initialViewport,
					visibleStartMs: newStart,
					visibleEndMs: newEnd,
				};
				break;
			}
		}

		props.onViewportChange(clampViewport(newViewport));
	};

	// Handle drag end
	const handleMouseUp = () => {
		setDragState(null);
	};

	// Set up global mouse event listeners for drag
	onMount(() => {
		const onMouseMove = (e: MouseEvent) => handleMouseMove(e);
		const onMouseUp = () => handleMouseUp();

		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);

		onCleanup(() => {
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
		});
	});

	// Determine cursor based on drag state
	const getCursor = () => {
		const state = dragState();
		if (!state) return undefined;
		if (state.mode === "pan") return "grabbing";
		return "ew-resize";
	};

	return (
		<div
			ref={containerRef}
			class="relative h-6 bg-gray-50 border-b border-gray-200 flex-shrink-0 select-none"
			style={{ cursor: getCursor() }}
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

				{/* Viewport box - draggable center for panning */}
				{/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle for viewport panning */}
				<div
					class="absolute top-0 bottom-0 bg-blue-500/10 border-y border-blue-400/50"
					style={{
						left: `${viewportStartPercent()}%`,
						width: `${viewportWidthPercent()}%`,
						cursor: dragState()?.mode === "pan" ? "grabbing" : "grab",
					}}
					onMouseDown={handleMouseDown("pan")}
				/>

				{/* Left handle */}
				{/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle for viewport resize */}
				<div
					class="absolute top-0 bottom-0 w-1.5 bg-blue-500 hover:bg-blue-600 cursor-ew-resize z-10 transition-colors"
					style={{
						left: `${viewportStartPercent()}%`,
						transform: "translateX(-50%)",
					}}
					onMouseDown={handleMouseDown("left-handle")}
				>
					{/* Handle grip indicator */}
					<div class="absolute inset-y-1 left-0.5 w-px bg-blue-300" />
				</div>

				{/* Right handle */}
				{/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle for viewport resize */}
				<div
					class="absolute top-0 bottom-0 w-1.5 bg-blue-500 hover:bg-blue-600 cursor-ew-resize z-10 transition-colors"
					style={{
						left: `${viewportEndPercent()}%`,
						transform: "translateX(-50%)",
					}}
					onMouseDown={handleMouseDown("right-handle")}
				>
					{/* Handle grip indicator */}
					<div class="absolute inset-y-1 left-0.5 w-px bg-blue-300" />
				</div>
			</Show>

			{/* Tick marks and labels */}
			<For each={ticks()}>
				{(tick, index) => {
					const isLast = () => index() === ticks().length - 1;

					return (
						<div
							class="absolute top-0 bottom-0 flex items-center pointer-events-none"
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
