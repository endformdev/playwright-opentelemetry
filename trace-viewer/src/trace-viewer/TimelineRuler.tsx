import {
	createEffect,
	createMemo,
	createSignal,
	For,
	on,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import type { ScreenshotInfo } from "../trace-info-loader";
import { useViewportContext } from "./contexts/ViewportContext";
import { RulerFilmstrip } from "./RulerFilmstrip";
import {
	describeStepRulerTime,
	getStepRulerItemAtTime,
	type StepRulerHooks,
	type StepRulerItem,
	type StepRulerSegments,
	type StepRulerStep,
} from "./stepRulerSegments";
import { calculateTimelineScale, type TimelineTick } from "./timelineScale";
import {
	clampViewport,
	isFullyZoomedOut,
	type TimelineViewport,
	timeToTotalPosition,
} from "./viewport";

export interface TimelineRulerProps {
	/** Duration in milliseconds */
	durationMs: number;
	/** Current viewport state for showing the visible region indicator */
	viewport: TimelineViewport;
	/** Callback when viewport is adjusted via handle drag or pan */
	onViewportChange?: (newViewport: TimelineViewport) => void;
	/** Callback when ruler is double-clicked (for zoom reset) */
	onDoubleClick?: () => void;
	segments: StepRulerSegments;
	/** The locked time, marked with the playhead knob; null when unlocked */
	playheadMs: number | null;
	/** The stop of the step the viewer is on, drawn as current */
	currentStopIndex: number | null;
	/** Time hovered elsewhere (the span panels), marked with a thin line */
	hoverTimeMs: number | null;
	/** A press anywhere on the ruler, or a drag along it, seeks */
	onSeek: (timeMs: number) => void;
	/**
	 * The pointer moving over the ruler, with the step under it, or leaving
	 * it (null)
	 */
	onPointerTime: (timeMs: number | null, stepId: string | null) => void;
	screenshots: ScreenshotInfo[];
	testStartTimeMs: number;
	/**
	 * Whether hovering opens a filmstrip of the whole test; not while the
	 * step viewer already shows one
	 */
	showFilmstrip: boolean;
	/** Where the filmstrip opens while the pointer is on the ruler */
	filmstripPlacement: "above" | "below";
	/** Moments or ranges to point out, e.g. a highlighted span */
	markers?: RulerMarker[];
}

export interface RulerMarker {
	timeMs: number;
	/** Where a range ends; without it the marker is a line at timeMs */
	endMs?: number;
	label: string;
}

/** Past this share of the ruler, a marker's label sits left of its line. */
const MARKER_LABEL_FLIP_PERCENT = 70;

/** Aligns ruler content with the shared timeline plot box. */
const PLOT_STYLE = {
	left: "var(--timeline-plot-inset)",
	width: "var(--timeline-plot-width)",
};

/** Minimum viewport width as percentage of total duration */
const MIN_VIEWPORT_WIDTH_PERCENT = 0.01;
/** How far a press on the zoom window moves before it pans instead of seeking */
const CLICK_SLOP_PX = 3;

/** Light stripes at the slant of the Endform logo, so hooks read hatched both before and after the playhead */
const HOOKS_BACKGROUND =
	"repeating-linear-gradient(112deg, rgb(255 255 255 / 0.7) 0 2px, transparent 2px 5px)";

type RulerDragMode = "left-handle" | "right-handle" | "pan";

interface RulerDragState {
	mode: RulerDragMode;
	startMouseX: number;
	containerWidth: number;
	initialViewport: TimelineViewport;
}

/**
 * The step ruler: the whole test as a scrubber. A solid bar along the top,
 * filled green up to the playhead, with a line at each step's edges and the
 * hooks hatched at either end; the time ticks run below it. When zoomed, the
 * visible window is drawn over the ticks and can be dragged or resized.
 *
 * Hovering anywhere on the ruler opens a filmstrip of the whole test, lined
 * up with it. Pressing anywhere on it locks that exact time, and dragging
 * keeps locking under the pointer.
 */
export function TimelineRuler(props: TimelineRulerProps) {
	const { motionTransition } = useViewportContext();
	let plotRef: HTMLDivElement | undefined;

	const [ticks, setTicks] = createSignal<TimelineTick[]>([]);
	const [dragState, setDragState] = createSignal<RulerDragState | null>(null);
	/** The pointer pressed on the ruler, scrubbing while it moves */
	const [scrubPointerId, setScrubPointerId] = createSignal<number | null>(null);
	const [pointer, setPointer] = createSignal<{
		timeMs: number;
		item: StepRulerItem | null;
	} | null>(null);

	const updateTicks = () => {
		const width = plotRef?.getBoundingClientRect().width ?? 0;
		if (width > 0)
			setTicks(calculateTimelineScale(props.durationMs, width).ticks);
	};
	onMount(() => {
		if (!plotRef) return;
		const resizeObserver = new ResizeObserver(updateTicks);
		resizeObserver.observe(plotRef);
		onCleanup(() => resizeObserver.disconnect());
	});
	createEffect(on(() => props.durationMs, updateTicks));

	const toPercent = (timeMs: number) =>
		timeToTotalPosition(timeMs, props.viewport) * 100;
	const viewportStartPercent = () => toPercent(props.viewport.visibleStartMs);
	const viewportEndPercent = () => toPercent(props.viewport.visibleEndMs);

	const timeAtClientX = (clientX: number): number | null => {
		const rect = plotRef?.getBoundingClientRect();
		if (!rect || rect.width <= 0) return null;
		const position = Math.max(
			0,
			Math.min(1, (clientX - rect.left) / rect.width),
		);
		return position * props.durationMs;
	};

	const seekAt = (clientX: number) => {
		const timeMs = timeAtClientX(clientX);
		if (timeMs !== null) props.onSeek(timeMs);
	};

	const handlePointerMove = (event: PointerEvent) => {
		const timeMs = timeAtClientX(event.clientX);
		if (timeMs === null) return;
		const item = getStepRulerItemAtTime(props.segments, timeMs);
		setPointer({ timeMs, item });
		props.onPointerTime(timeMs, item?.kind === "step" ? item.step.id : null);
		if (scrubPointerId() === event.pointerId) props.onSeek(timeMs);
	};

	const handlePointerLeave = () => {
		if (scrubPointerId() !== null) return;
		setPointer(null);
		props.onPointerTime(null, null);
	};

	// The zoom window and its handles drag with the mouse; everywhere else a
	// press locks the time under it.
	const handlePointerDown = (event: PointerEvent) => {
		if (event.button !== 0) return;
		if (
			event.target instanceof Element &&
			event.target.closest("[data-zoom-control]")
		) {
			return;
		}
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		setScrubPointerId(event.pointerId);
		seekAt(event.clientX);
	};

	// Released outside the ruler, the pointer leaves it once capture ends.
	const endScrub = (event: PointerEvent) => {
		if (scrubPointerId() === event.pointerId) setScrubPointerId(null);
	};

	// Handle drag start on handles or viewport center
	const handleMouseDown = (mode: RulerDragMode) => (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();

		if (!plotRef) return;

		setDragState({
			mode,
			startMouseX: e.clientX,
			containerWidth: plotRef.getBoundingClientRect().width,
			initialViewport: { ...props.viewport },
		});
	};

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
				const maxStart =
					state.initialViewport.visibleEndMs -
					state.initialViewport.totalDurationMs * MIN_VIEWPORT_WIDTH_PERCENT;

				newViewport = {
					...state.initialViewport,
					visibleStartMs: Math.max(0, Math.min(maxStart, newStart)),
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

	// Set up global mouse event listeners for drag
	onMount(() => {
		const onMouseMove = (e: MouseEvent) => handleMouseMove(e);
		const onMouseUp = (e: MouseEvent) => {
			const state = dragState();
			setDragState(null);
			// A click on the zoom window, without panning it, seeks there too.
			if (
				state?.mode === "pan" &&
				Math.abs(e.clientX - state.startMouseX) < CLICK_SLOP_PX
			) {
				seekAt(e.clientX);
			}
		};

		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);

		onCleanup(() => {
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
		});
	});

	const getCursor = () => {
		const state = dragState();
		if (!state) return undefined;
		if (state.mode === "pan") return "grabbing";
		return "ew-resize";
	};

	// While the pointer is on the ruler it marks the time; otherwise the
	// time hovered in the span panels does.
	const hoverLineTimeMs = () => pointer()?.timeMs ?? props.hoverTimeMs;

	const filmstripLabel = createMemo(() => {
		const current = pointer();
		return current ? describeStepRulerTime(props.segments, current.timeMs) : "";
	});

	const rangeStyle = (startMs: number, endMs: number) => ({
		left: `${toPercent(startMs)}%`,
		width: `${toPercent(endMs) - toPercent(startMs)}%`,
	});

	/** The step the viewer is on and the one under the pointer stand out. */
	const isHighlighted = (segment: StepRulerStep) => {
		const item = pointer()?.item;
		return (
			segment.stopIndex === props.currentStopIndex ||
			(item?.kind === "step" && item.stopIndex === segment.stopIndex)
		);
	};
	const isHoveredHooks = (hooks: StepRulerHooks) =>
		pointer()?.item?.kind === hooks.kind;

	/** Where a line marks a step's start or end, once per time */
	const stepEdgesMs = createMemo(() => [
		...new Set(
			props.segments.steps.flatMap((segment) => [
				segment.startMs,
				segment.endMs,
			]),
		),
	]);

	const handleDoubleClick = (e: MouseEvent) => {
		e.stopPropagation();
		props.onDoubleClick?.();
	};

	return (
		<div
			class="relative flex-shrink-0 cursor-pointer select-none border-b border-gray-200 bg-white"
			data-testid="timeline-ruler"
			style={{ cursor: getCursor() }}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={endScrub}
			onPointerCancel={endScrub}
			onPointerLeave={handlePointerLeave}
			onDblClick={handleDoubleClick}
		>
			<Show when={props.showFilmstrip}>
				<RulerFilmstrip
					open={pointer() !== null}
					placement={props.filmstripPlacement}
					screenshots={props.screenshots}
					testStartTimeMs={props.testStartTimeMs}
					durationMs={props.durationMs}
					pointerTimeMs={pointer()?.timeMs ?? null}
					label={filmstripLabel()}
				/>
			</Show>

			<div class="relative h-[52px]">
				<div ref={plotRef} class="absolute inset-y-0" style={PLOT_STYLE}>
					{/* Out of view when zoomed: dimmed across the whole ruler */}
					<Show when={!isFullyZoomedOut(props.viewport)}>
						<div
							class="pointer-events-none absolute inset-y-0 left-0 z-20 bg-gray-400/15"
							style={{
								width: `${viewportStartPercent()}%`,
								transition: motionTransition("width"),
							}}
						/>
						<div
							class="pointer-events-none absolute inset-y-0 right-0 z-20 bg-gray-400/15"
							style={{
								left: `${viewportEndPercent()}%`,
								transition: motionTransition("left"),
							}}
						/>
					</Show>

					{/* Step bar: one solid bar, lined at each step's edges */}
					<div
						class="absolute inset-x-0 top-0 h-6"
						data-testid="step-ruler-bar"
					>
						<div class="absolute inset-x-0 top-2 h-3 overflow-hidden rounded-[3px] bg-gray-200">
							<Show when={props.playheadMs !== null}>
								<div
									class="absolute inset-y-0 left-0 bg-fill-playhead"
									style={{ width: `${toPercent(props.playheadMs!)}%` }}
									data-testid="step-ruler-fill"
								/>
							</Show>
							<For each={props.segments.steps}>
								{(segment) => (
									<div
										class="absolute inset-y-0"
										classList={{ "bg-gray-900/25": isHighlighted(segment) }}
										style={rangeStyle(segment.startMs, segment.endMs)}
										data-testid="step-ruler-step"
										data-stop-index={segment.stopIndex}
										data-span-id={segment.step.id}
									/>
								)}
							</For>
							<For each={props.segments.hooks}>
								{(hooks) => (
									<div
										class="absolute inset-y-0"
										classList={{ "bg-gray-900/25": isHoveredHooks(hooks) }}
										style={{
											...rangeStyle(hooks.startMs, hooks.endMs),
											"background-image": HOOKS_BACKGROUND,
										}}
										data-testid="step-ruler-hooks"
										data-hooks={hooks.kind}
									/>
								)}
							</For>
						</div>
						{/* Step edges stand a little proud of the bar, green once played */}
						<For each={stepEdgesMs()}>
							{(timeMs) => (
								<div
									class="pointer-events-none absolute top-[5px] h-[18px] w-px"
									classList={{
										"bg-fill-playhead-strong":
											props.playheadMs !== null && timeMs <= props.playheadMs,
										"bg-gray-400":
											props.playheadMs === null || timeMs > props.playheadMs,
									}}
									style={{ left: `${toPercent(timeMs)}%` }}
									data-testid="step-ruler-edge"
								/>
							)}
						</For>
					</div>

					{/* Time ticks, with the zoom window over them when zoomed */}
					<div class="absolute inset-x-0 top-6 bottom-0">
						<For each={ticks()}>
							{(tick, index) => (
								<div
									class="pointer-events-none absolute inset-y-0 flex items-center"
									style={{ left: `${tick.position * 100}%` }}
								>
									<div class="h-3 w-px bg-gray-300" />
									<span
										class="whitespace-nowrap pl-1 text-[10px] text-gray-500"
										style={{
											position:
												index() === ticks().length - 1
													? "absolute"
													: "relative",
											right: index() === ticks().length - 1 ? "1px" : undefined,
										}}
									>
										{tick.label}
									</span>
								</div>
							)}
						</For>

						<Show when={!isFullyZoomedOut(props.viewport)}>
							<div
								class="absolute inset-y-1 rounded-sm border border-gray-400/60 bg-gray-900/5"
								data-zoom-control
								style={{
									left: `${viewportStartPercent()}%`,
									width: `${viewportEndPercent() - viewportStartPercent()}%`,
									cursor: dragState()?.mode === "pan" ? "grabbing" : "grab",
									transition: motionTransition("left", "width"),
								}}
								data-testid="ruler-zoom-window"
								onMouseDown={handleMouseDown("pan")}
							/>
							<For each={["left-handle", "right-handle"] as const}>
								{(mode) => (
									<div
										class="absolute inset-y-1 z-10 w-1.5 cursor-ew-resize rounded-sm bg-gray-500 transition-colors hover:bg-gray-700"
										data-zoom-control
										style={{
											left: `${mode === "left-handle" ? viewportStartPercent() : viewportEndPercent()}%`,
											transform: "translateX(-50%)",
											transition: motionTransition("left"),
										}}
										onMouseDown={handleMouseDown(mode)}
									>
										<div class="absolute inset-y-1 left-0.5 w-px bg-gray-300" />
									</div>
								)}
							</For>
						</Show>
					</div>

					{/* Markers: a line or a range over the step bar, labelled below it */}
					<For each={props.markers ?? []}>
						{(marker) => (
							<div
								class="pointer-events-none absolute inset-y-0 z-30"
								style={{
									left: `${toPercent(marker.timeMs)}%`,
									width:
										marker.endMs === undefined
											? undefined
											: `${toPercent(marker.endMs) - toPercent(marker.timeMs)}%`,
								}}
								data-testid="step-ruler-marker"
								data-time-ms={marker.timeMs}
								data-end-ms={marker.endMs}
							>
								<Show
									when={marker.endMs !== undefined}
									fallback={
										<div class="absolute top-0.5 h-6 -ml-px w-[3px] rounded-full bg-amber-500" />
									}
								>
									<div class="absolute inset-x-0 top-0.5 h-6 min-w-[3px] rounded-sm border border-amber-500 bg-amber-400/30" />
								</Show>
								<span
									class="absolute top-7 whitespace-nowrap rounded-sm bg-amber-100 px-1 text-[10px] font-medium text-amber-900"
									classList={{
										"left-1":
											toPercent(marker.timeMs) <= MARKER_LABEL_FLIP_PERCENT,
										"right-1":
											toPercent(marker.timeMs) > MARKER_LABEL_FLIP_PERCENT,
									}}
								>
									{marker.label}
								</span>
							</div>
						)}
					</For>

					{/* Hover line */}
					<Show when={hoverLineTimeMs() !== null}>
						<div
							class="pointer-events-none absolute inset-y-0 z-30 w-px bg-gray-900"
							style={{ left: `${toPercent(hoverLineTimeMs()!)}%` }}
						/>
					</Show>

					{/* Playhead: a knob on the step bar, its line running down into
					    the span panels' locked time line below */}
					<Show when={props.playheadMs !== null}>
						<div
							class="pointer-events-none absolute inset-y-0 z-40"
							style={{ left: `${toPercent(props.playheadMs!)}%` }}
						>
							<div
								class="absolute top-2 bottom-0 -ml-px w-[3px] bg-fill-playhead"
								data-testid="step-ruler-playhead"
								data-time-ms={props.playheadMs}
							/>
							<div class="absolute top-[7px] -ml-[7px] h-3.5 w-3.5 rounded-full bg-fill-playhead shadow ring-2 ring-white" />
						</div>
					</Show>
				</div>
			</div>
		</div>
	);
}
