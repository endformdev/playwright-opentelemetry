import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useTraceDataLoader } from "../trace-data-loader/useTraceDataLoader";
import type { TraceInfo } from "../trace-info-loader";
import { BrowserSpansPanel } from "./components/BrowserSpansPanel";
import { DetailsPanel } from "./components/DetailsPanel";
import { ExternalSpansPanel } from "./components/ExternalSpansPanel";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { StepsTimeline } from "./components/StepsTimeline";
import { HoverProvider } from "./contexts/HoverContext";
import { ViewportProvider } from "./contexts/ViewportContext";
import { getElementsAtTime, type HoveredElements } from "./getElementsAtTime";
import { ResizablePanel } from "./ResizablePanel";
import { ScreenshotFilmstrip } from "./ScreenshotFilmstrip";
import { TimelineRuler } from "./TimelineRuler";
import { TraceViewerHeader } from "./TraceViewerHeader";
import {
	createViewport,
	panViewport,
	resetViewport,
	type TimelineViewport,
	viewportPositionToTime,
	zoomToRange,
} from "./viewport";

export interface TraceViewerProps {
	traceInfo: TraceInfo;
}

type FocusedElementType = "screenshot" | "step" | "span";

interface FocusedElement {
	type: FocusedElementType;
	id: string; // span ID for steps/spans, or screenshot URL for screenshots
}

const PAN_SENSITIVITY = 0.2;
const LOCK_WINDOW_PX = 50;

export function TraceViewer(props: TraceViewerProps) {
	const traceData = useTraceDataLoader(() => props.traceInfo);
	const durationMs = () => traceData.totalDurationMs();

	const [viewport, setViewport] = createSignal<TimelineViewport>(
		createViewport(durationMs() || 1000),
	);
	const testStartTimeMs = () => {
		const startNano = BigInt(props.traceInfo.testInfo.startTimeUnixNano);
		return Number(startNano / BigInt(1_000_000));
	};

	createMemo(() => {
		const duration = durationMs();
		if (duration > 0) {
			setViewport(createViewport(duration));
		}
	});

	const [hoverPosition, setHoverPosition] = createSignal<number | null>(null);
	const [lockedPosition, setLockedPosition] = createSignal<number | null>(null);
	const [hoveredElement, setHoveredElement] =
		createSignal<FocusedElement | null>(null);
	const [lockedElement, setLockedElement] = createSignal<FocusedElement | null>(
		null,
	);
	const [selectionState, setSelectionState] = createSignal<{
		startPosition: number;
		currentPosition: number;
	} | null>(null);

	let mainPanelRef: HTMLDivElement | undefined;

	const handleMouseDown = (e: MouseEvent) => {
		// Only start selection on primary button
		if (e.button !== 0) return;
		if (!mainPanelRef) return;

		// Don't start selection if clicking on resize handles
		const target = e.target as HTMLElement;
		const computedStyle = window.getComputedStyle(target);
		if (
			computedStyle.cursor === "col-resize" ||
			computedStyle.cursor === "row-resize"
		) {
			return;
		}

		const rect = mainPanelRef.getBoundingClientRect();
		const position = (e.clientX - rect.left) / rect.width;

		if (position >= 0 && position <= 1) {
			setSelectionState({ startPosition: position, currentPosition: position });
		}
	};

	const handleMouseMove = (e: MouseEvent) => {
		if (!mainPanelRef) return;

		const rect = mainPanelRef.getBoundingClientRect();
		const position = (e.clientX - rect.left) / rect.width;

		// Update selection if dragging
		const selection = selectionState();
		if (selection) {
			const clampedPosition = Math.max(0, Math.min(1, position));
			setSelectionState({
				startPosition: selection.startPosition,
				currentPosition: clampedPosition,
			});
		}

		// Check if hovering over a resize handle (they have cursor-*-resize)
		const target = e.target as HTMLElement;
		const computedStyle = window.getComputedStyle(target);
		if (
			computedStyle.cursor === "col-resize" ||
			computedStyle.cursor === "row-resize"
		) {
			setHoverPosition(null);
			return;
		}

		// Clamp to valid range
		if (position >= 0 && position <= 1) {
			setHoverPosition(position);
		} else {
			setHoverPosition(null);
		}
	};

	const handleMouseUp = () => {
		const selection = selectionState();
		if (selection) {
			const startMs = viewportPositionToTime(
				Math.min(selection.startPosition, selection.currentPosition),
				viewport(),
			);
			const endMs = viewportPositionToTime(
				Math.max(selection.startPosition, selection.currentPosition),
				viewport(),
			);

			// Only zoom if selection is meaningful (not just a click)
			// Minimum 2% of current visible duration
			const visibleDuration =
				viewport().visibleEndMs - viewport().visibleStartMs;
			const minSelectionMs = visibleDuration * 0.02;

			if (endMs - startMs > minSelectionMs) {
				// This was a drag - zoom to selection
				setViewport((v) => zoomToRange(v, startMs, endMs));
			} else {
				// This was a click (not a meaningful drag) - lock to this position
				setLockedPosition(selection.startPosition);
				// Also lock the currently hovered element for scroll-to functionality
				setLockedElement(hoveredElement());
			}

			setSelectionState(null);
		}
	};

	const handleMouseLeave = () => {
		setHoverPosition(null);
		// Don't clear selection on mouse leave - user might drag outside temporarily
	};

	// Set up global mouseup listener to handle drag end outside component
	onMount(() => {
		const onGlobalMouseUp = () => handleMouseUp();
		document.addEventListener("mouseup", onGlobalMouseUp);

		onCleanup(() => {
			document.removeEventListener("mouseup", onGlobalMouseUp);
		});
	});

	const handleViewportChange = (newViewport: TimelineViewport) => {
		setViewport(newViewport);
	};

	const handleWheel = (e: WheelEvent) => {
		if (!mainPanelRef) return;

		const isHorizontalScroll = Math.abs(e.deltaX) > Math.abs(e.deltaY);

		if (isHorizontalScroll) {
			e.preventDefault();

			const visibleDuration =
				viewport().visibleEndMs - viewport().visibleStartMs;
			const panDeltaMs = (e.deltaX * PAN_SENSITIVITY * visibleDuration) / 100;
			setViewport((v) => panViewport(v, panDeltaMs));
		}
	};

	const handleDoubleClick = () => {
		setLockedPosition(null);
		setLockedElement(null);
		setViewport((v) => resetViewport(v));
	};

	// We intentionally do NOT clear hoveredElement on mouseLeave (null).
	// The last hovered element persists until a new element is hovered or
	// the mouse leaves the main panel entirely.
	const handleScreenshotHover = (screenshotUrl: string | null) => {
		if (screenshotUrl) {
			setHoveredElement({ type: "screenshot", id: screenshotUrl });
		}
	};

	const handleStepHover = (stepId: string | null) => {
		if (stepId) {
			setHoveredElement({ type: "step", id: stepId });
		}
	};

	const handleSpanHover = (spanId: string | null) => {
		if (spanId) {
			setHoveredElement({ type: "span", id: spanId });
		}
	};

	const hoverTimeMs = () => {
		const pos = hoverPosition();
		if (pos === null) return null;
		return viewportPositionToTime(pos, viewport());
	};

	const lockedTimeMs = () => {
		const pos = lockedPosition();
		if (pos === null) return null;
		return viewportPositionToTime(pos, viewport());
	};

	const isWithinLockWindow = () => {
		const locked = lockedPosition();
		const hover = hoverPosition();
		if (locked === null || hover === null || !mainPanelRef) return false;

		const panelWidth = mainPanelRef.getBoundingClientRect().width;
		const lockedPx = locked * panelWidth;
		const hoverPx = hover * panelWidth;
		return Math.abs(hoverPx - lockedPx) <= LOCK_WINDOW_PX;
	};

	const hoveredElements = createMemo((): HoveredElements | null => {
		const timeMs = hoverTimeMs();
		if (timeMs === null) return null;
		return getElementsAtTime(
			timeMs,
			traceData.steps(),
			[...traceData.browserSpans(), ...traceData.externalSpans()],
			props.traceInfo.screenshots,
			testStartTimeMs(),
		);
	});

	const lockedElements = createMemo((): HoveredElements | null => {
		const timeMs = lockedTimeMs();
		if (timeMs === null) return null;
		return getElementsAtTime(
			timeMs,
			traceData.steps(),
			[...traceData.browserSpans(), ...traceData.externalSpans()],
			props.traceInfo.screenshots,
			testStartTimeMs(),
		);
	});

	// Determine what to display in details panel and header:
	// - If locked and (no hover OR within lock window): show locked data
	// - If locked and outside lock window: show hover data
	// - If not locked: show hover data
	const displayElements = (): HoveredElements | null => {
		if (lockedPosition() !== null) {
			if (hoverPosition() === null || isWithinLockWindow()) {
				return lockedElements();
			}
			return hoveredElements();
		}
		return hoveredElements();
	};

	const displayTimeMs = (): number | null => {
		if (lockedPosition() !== null) {
			if (hoverPosition() === null || isWithinLockWindow()) {
				return lockedTimeMs();
			}
			return hoverTimeMs();
		}
		return hoverTimeMs();
	};

	// Determine which element to scroll to in the details panel.
	// The key behavior: when locked, if hovering over a specific element, scroll to it;
	// otherwise (no hover or generic hover), scroll to the locked element.
	const displayFocusedElement = (): FocusedElement | null => {
		if (lockedPosition() !== null) {
			if (hoverPosition() === null || isWithinLockWindow()) {
				// Mouse left the panel or is within lock window - scroll to locked element
				return lockedElement();
			}
			// Mouse is outside lock window - scroll to hovered element if any,
			// otherwise stay on locked element
			return hoveredElement() ?? lockedElement();
		}

		return hoveredElement();
	};

	const selectionLeft = () => {
		const selection = selectionState();
		if (!selection) return 0;
		return Math.min(selection.startPosition, selection.currentPosition) * 100;
	};

	const selectionWidth = () => {
		const selection = selectionState();
		if (!selection) return 0;
		return Math.abs(selection.currentPosition - selection.startPosition) * 100;
	};

	const MainPanelContent = () => (
		// biome-ignore lint/a11y/noStaticElementInteractions: container needs mouse tracking for hover line and drag selection
		<div
			ref={mainPanelRef}
			class="flex flex-col h-full relative"
			style={{ cursor: selectionState() ? "crosshair" : undefined }}
			onMouseDown={handleMouseDown}
			onMouseMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
			onWheel={handleWheel}
			onDblClick={handleDoubleClick}
		>
			<Show when={traceData.isLoading()}>
				<LoadingOverlay
					loaded={traceData.progress().loaded}
					total={traceData.progress().total}
				/>
			</Show>

			<TimelineRuler
				durationMs={durationMs()}
				viewport={viewport()}
				hoverPosition={hoverPosition()}
				onViewportChange={handleViewportChange}
			/>

			<div class="flex-1 min-h-0 relative">
				<ResizablePanel
					direction="vertical"
					initialFirstPanelSize={12}
					minFirstPanelSize={7}
					maxFirstPanelSize={40}
					firstPanel={
						<ScreenshotFilmstrip
							screenshots={props.traceInfo.screenshots}
							viewport={viewport()}
							testStartTimeMs={testStartTimeMs()}
							onScreenshotHover={handleScreenshotHover}
						/>
					}
					secondPanel={
						<ResizablePanel
							direction="vertical"
							initialFirstPanelSize={40}
							minFirstPanelSize={20}
							maxFirstPanelSize={60}
							firstPanel={
								<StepsTimeline
									steps={traceData.steps()}
									onStepHover={handleStepHover}
								/>
							}
							secondPanel={
								<ResizablePanel
									direction="vertical"
									initialFirstPanelSize={50}
									minFirstPanelSize={20}
									maxFirstPanelSize={80}
									firstPanel={
										<BrowserSpansPanel
											spans={traceData.browserSpans()}
											onSpanHover={handleSpanHover}
										/>
									}
									secondPanel={
										<ExternalSpansPanel
											spans={traceData.externalSpans()}
											onSpanHover={handleSpanHover}
										/>
									}
								/>
							}
						/>
					}
				/>

				<Show when={selectionState()}>
					<div
						class="absolute top-0 bottom-0 bg-blue-500/20 border-x-2 border-blue-500 pointer-events-none z-40"
						style={{
							left: `${selectionLeft()}%`,
							width: `${selectionWidth()}%`,
						}}
					/>
				</Show>

				<Show when={lockedPosition()} keyed>
					{(pos) => (
						<div
							class="absolute top-0 bottom-0 bg-blue-600 pointer-events-none z-50"
							style={{
								left: `${pos * 100}%`,
								width: "3px",
								"margin-left": "-1px",
							}}
						/>
					)}
				</Show>

				<Show
					when={
						hoverPosition() !== null &&
						lockedPosition() !== null &&
						!isWithinLockWindow()
					}
					keyed
				>
					<div
						class="absolute top-0 bottom-0 w-px bg-blue-400 pointer-events-none z-45"
						style={{ left: `${hoverPosition()! * 100}%` }}
					/>
				</Show>

				<Show
					when={hoverPosition() !== null && lockedPosition() === null}
					keyed
				>
					<div
						class="absolute top-0 bottom-0 w-px bg-blue-500 pointer-events-none z-50"
						style={{ left: `${hoverPosition()! * 100}%` }}
					/>
				</Show>
			</div>
		</div>
	);

	return (
		<ViewportProvider durationMs={durationMs} testStartTimeMs={testStartTimeMs}>
			<HoverProvider
				steps={() => traceData.steps()}
				spans={() => [
					...traceData.browserSpans(),
					...traceData.externalSpans(),
				]}
				screenshots={props.traceInfo.screenshots}
				testStartTimeMs={testStartTimeMs}
			>
				<div class="flex flex-col h-full w-full bg-white text-gray-900">
					<TraceViewerHeader
						testInfo={props.traceInfo.testInfo}
						hoverTimeMs={displayTimeMs}
					/>

					<div class="flex-1 min-h-0">
						<ResizablePanel
							direction="horizontal"
							initialFirstPanelSize={75}
							minFirstPanelSize={50}
							maxFirstPanelSize={90}
							firstPanel={<MainPanelContent />}
							secondPanel={
								<DetailsPanel
									traceInfo={props.traceInfo}
									hoveredElements={displayElements()}
									testStartTimeMs={testStartTimeMs()}
									focusedElement={displayFocusedElement()}
								/>
							}
						/>
					</div>
				</div>
			</HoverProvider>
		</ViewportProvider>
	);
}
