import {
	createEffect,
	createMemo,
	createSignal,
	For,
	type JSX,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import type { Span, SpanKind } from "../trace-data-loader/exportToSpans";
import { useTraceDataLoader } from "../trace-data-loader/useTraceDataLoader";
import type { TraceInfo } from "../trace-info-loader";
import {
	flattenHoveredSpans,
	getElementsAtTime,
	type HoveredElements,
	type HoveredSpan,
} from "./getElementsAtTime";
import {
	generateConnectors,
	type PackedSpan,
	packSpans,
	type SpanConnector,
	type SpanInput,
} from "./packSpans";
import { ResizablePanel } from "./ResizablePanel";
import { ScreenshotFilmstrip } from "./ScreenshotFilmstrip";
import { TimelineRuler } from "./TimelineRuler";
import { TraceViewerHeader } from "./TraceViewerHeader";
import {
	createViewport,
	isTimeRangeVisible,
	panViewport,
	resetViewport,
	type TimelineViewport,
	timeToViewportPosition,
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
const ROW_HEIGHT = 28;

/** Lock window size in pixels - hovering within this distance of locked position keeps data locked */
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

	// Handle viewport changes from the timeline ruler (handle drags)
	const handleViewportChange = (newViewport: TimelineViewport) => {
		setViewport(newViewport);
	};

	// Handle scroll wheel for horizontal panning only (vertical scroll passes through for span scrolling)
	const handleWheel = (e: WheelEvent) => {
		if (!mainPanelRef) return;

		// Check if this is a horizontal scroll (shift+wheel or trackpad horizontal gesture)
		const isHorizontalScroll = Math.abs(e.deltaX) > Math.abs(e.deltaY);

		if (isHorizontalScroll) {
			// Prevent default only for horizontal scroll (we handle panning)
			e.preventDefault();

			// Horizontal scroll = pan left/right
			const visibleDuration =
				viewport().visibleEndMs - viewport().visibleStartMs;
			// deltaX > 0 = scroll right = pan right (move viewport forward in time)
			const panDeltaMs = (e.deltaX * PAN_SENSITIVITY * visibleDuration) / 100;
			setViewport((v) => panViewport(v, panDeltaMs));
		}
		// Let vertical scroll propagate naturally for scrolling through spans
	};

	// Handle double-click to reset zoom and unlock
	const handleDoubleClick = () => {
		setLockedPosition(null);
		setLockedElement(null);
		setViewport((v) => resetViewport(v));
	};

	// Handlers for element hover tracking (for scroll-to-span functionality)
	// NOTE: We intentionally do NOT clear hoveredElement on mouseLeave (null).
	// The last hovered element persists until a new element is hovered or
	// the mouse leaves the main panel entirely. This prevents flickering
	// when moving between elements or crossing boundaries between sections.
	const handleScreenshotHover = (screenshotUrl: string | null) => {
		if (screenshotUrl) {
			setHoveredElement({ type: "screenshot", id: screenshotUrl });
		}
		// Don't clear on null - last hovered element persists
	};

	const handleStepHover = (stepId: string | null) => {
		if (stepId) {
			setHoveredElement({ type: "step", id: stepId });
		}
		// Don't clear on null - last hovered element persists
	};

	const handleSpanHover = (spanId: string | null) => {
		if (spanId) {
			setHoveredElement({ type: "span", id: spanId });
		}
		// Don't clear on null - last hovered element persists
	};

	// Convert hover position (0-1 in viewport space) to time in milliseconds
	const hoverTimeMs = () => {
		const pos = hoverPosition();
		if (pos === null) return null;
		return viewportPositionToTime(pos, viewport());
	};

	// Convert locked position to time in milliseconds
	const lockedTimeMs = () => {
		const pos = lockedPosition();
		if (pos === null) return null;
		return viewportPositionToTime(pos, viewport());
	};

	// Check if hover position is within the lock window (in pixels)
	const isWithinLockWindow = () => {
		const locked = lockedPosition();
		const hover = hoverPosition();
		if (locked === null || hover === null || !mainPanelRef) return false;

		const panelWidth = mainPanelRef.getBoundingClientRect().width;
		const lockedPx = locked * panelWidth;
		const hoverPx = hover * panelWidth;
		return Math.abs(hoverPx - lockedPx) <= LOCK_WINDOW_PX;
	};

	// Compute hovered elements (at hover time)
	const hoveredElements = createMemo((): HoveredElements | null => {
		const timeMs = hoverTimeMs();
		if (timeMs === null) return null;
		return getElementsAtTime(
			timeMs,
			traceData.steps(),
			traceData.spans(),
			props.traceInfo.screenshots,
			testStartTimeMs(),
		);
	});

	// Compute locked elements (at locked time)
	const lockedElements = createMemo((): HoveredElements | null => {
		const timeMs = lockedTimeMs();
		if (timeMs === null) return null;
		return getElementsAtTime(
			timeMs,
			traceData.steps(),
			traceData.spans(),
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
			// We have a lock
			if (hoverPosition() === null || isWithinLockWindow()) {
				// Mouse left the panel or is within lock window - show locked data
				return lockedElements();
			}
			// Mouse is outside lock window - show hover data
			return hoveredElements();
		}
		// No lock - show hover data
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
			// We have a lock
			if (hoverPosition() === null || isWithinLockWindow()) {
				// Mouse left the panel or is within lock window - scroll to locked element
				return lockedElement();
			}
			// Mouse is outside lock window - scroll to hovered element if any,
			// otherwise stay on locked element
			return hoveredElement() ?? lockedElement();
		}
		// No lock - scroll to hovered element
		return hoveredElement();
	};

	// Loading state UI
	const loadingOverlay = () => {
		if (!traceData.isLoading()) return null;
		const { loaded, total } = traceData.progress();
		return (
			<div class="absolute inset-0 bg-white/80 flex items-center justify-center z-50">
				<div class="text-center">
					<div class="text-gray-600 mb-2">Loading trace data...</div>
					<div class="text-sm text-gray-400">
						{loaded} / {total} files
					</div>
					<div class="w-48 h-2 bg-gray-200 rounded-full mt-2 overflow-hidden">
						<div
							class="h-full bg-blue-500 transition-all duration-200"
							style={{ width: `${total > 0 ? (loaded / total) * 100 : 0}%` }}
						/>
					</div>
				</div>
			</div>
		);
	};

	// Calculate selection overlay position (in viewport space, as percentages)
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

	// Main Panel content (with fixed timeline ruler + vertical splits for Screenshot, Steps, Spans)
	const mainPanelContent = (
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
			{/* Loading overlay */}
			{loadingOverlay()}

			{/* Fixed height timeline ruler at the top - always shows full duration */}
			{/* Ruler has draggable handles for adjusting the viewport */}
			<TimelineRuler
				durationMs={durationMs()}
				viewport={viewport()}
				hoverPosition={hoverPosition()}
				onViewportChange={handleViewportChange}
			/>

			{/* Remaining space for resizable panels - with hover line overlay */}
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
							initialFirstPanelSize={60}
							minFirstPanelSize={20}
							maxFirstPanelSize={80}
							firstPanel={
								<StepsTimeline
									steps={traceData.steps()}
									totalDurationMs={durationMs()}
									viewport={viewport()}
									onStepHover={handleStepHover}
								/>
							}
							secondPanel={
								<SpansPanel
									spans={traceData.spans()}
									totalDurationMs={durationMs()}
									viewport={viewport()}
									onSpanHover={handleSpanHover}
								/>
							}
						/>
					}
				/>

				{/* Selection overlay while dragging */}
				<Show when={selectionState()}>
					<div
						class="absolute top-0 bottom-0 bg-blue-500/20 border-x-2 border-blue-500 pointer-events-none z-40"
						style={{
							left: `${selectionLeft()}%`,
							width: `${selectionWidth()}%`,
						}}
					/>
				</Show>

				{/* Locked position indicator - thick bold line */}
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

				{/* Hover line overlay - thin line when exploring outside lock window */}
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

				{/* Hover line overlay when not locked - standard thin line */}
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
		<div class="flex flex-col h-full w-full bg-white text-gray-900">
			<TraceViewerHeader
				testInfo={props.traceInfo.testInfo}
				hoverTimeMs={displayTimeMs}
			/>

			{/* Resizable Main Content Area */}
			<div class="flex-1 min-h-0">
				<ResizablePanel
					direction="horizontal"
					initialFirstPanelSize={75}
					minFirstPanelSize={50}
					maxFirstPanelSize={90}
					firstPanel={mainPanelContent}
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
	);
}

/**
 * Converts Span[] to SpanInput[] for packSpans.
 */
function spansToSpanInput(spans: Span[]): SpanInput[] {
	return spans.map((span) => ({
		id: span.id,
		name: span.title,
		startOffset: span.startOffsetMs,
		duration: span.durationMs,
		parentId: span.parentId,
	}));
}

/**
 * Builds a depth map for hierarchical coloring of steps.
 * Depth is determined by following parentId chains.
 */
function buildDepthMap(spans: Span[]): Map<string, number> {
	const depthMap = new Map<string, number>();
	const spanMap = new Map<string, Span>();

	// Build lookup map
	for (const span of spans) {
		spanMap.set(span.id, span);
	}

	// Calculate depth for each span
	const getDepth = (span: Span): number => {
		if (depthMap.has(span.id)) {
			return depthMap.get(span.id)!;
		}

		if (span.parentId === null) {
			depthMap.set(span.id, 0);
			return 0;
		}

		const parent = spanMap.get(span.parentId);
		if (!parent) {
			depthMap.set(span.id, 0);
			return 0;
		}

		const depth = getDepth(parent) + 1;
		depthMap.set(span.id, depth);
		return depth;
	};

	for (const span of spans) {
		getDepth(span);
	}

	return depthMap;
}

interface StepsTimelineProps {
	steps: Span[];
	totalDurationMs: number;
	viewport: TimelineViewport;
	onStepHover?: (stepId: string | null) => void;
}

function StepsTimeline(props: StepsTimelineProps) {
	// Convert and pack steps
	const packedStepsResult = createMemo(() => {
		const spanInputs = spansToSpanInput(props.steps);
		return packSpans(spanInputs);
	});

	// Build depth map for coloring
	const depthMap = createMemo(() => buildDepthMap(props.steps));

	// Filter and position steps based on viewport
	const visibleSteps = createMemo(() => {
		return packedStepsResult().spans.filter((step) =>
			isTimeRangeVisible(
				step.startOffset,
				step.startOffset + step.duration,
				props.viewport,
			),
		);
	});

	// Generate connectors only for visible spans
	const visibleConnectors = createMemo(() => {
		const visibleIds = new Set(visibleSteps().map((s) => s.id));
		return generateConnectors(
			packedStepsResult().spans,
			props.totalDurationMs,
		).filter((c) => visibleIds.has(c.parentId) || visibleIds.has(c.childId));
	});

	const renderStep = (step: PackedSpan): JSX.Element => {
		// Use reactive getters so positions update when viewport changes
		const leftPercent = () =>
			timeToViewportPosition(step.startOffset, props.viewport) * 100;
		const rightPercent = () =>
			timeToViewportPosition(step.startOffset + step.duration, props.viewport) *
			100;
		const widthPercent = () => rightPercent() - leftPercent();
		const depth = depthMap().get(step.id) ?? 0;

		return (
			// biome-ignore lint/a11y/noStaticElementInteractions: hover tracking for scroll-to-span feature
			<div
				class="absolute h-6 rounded text-xs flex items-center px-2 text-white truncate cursor-pointer hover:brightness-95"
				style={{
					left: `${leftPercent()}%`,
					width: `${Math.max(widthPercent(), 3)}%`,
					top: `${step.row * ROW_HEIGHT}px`,
					"background-color": `hsl(${210 + depth * 30}, 70%, ${55 + depth * 5}%)`,
				}}
				title={`${step.name} (${step.duration}ms)`}
				onMouseEnter={() => props.onStepHover?.(step.id)}
				onMouseLeave={() => props.onStepHover?.(null)}
			>
				{step.name}
			</div>
		);
	};

	const renderConnector = (connector: SpanConnector): JSX.Element => {
		const rowDiff = connector.childRow - connector.parentRow;
		const topPx = connector.parentRow * ROW_HEIGHT + 24;
		const heightPx = (rowDiff - 1) * ROW_HEIGHT + 4;

		// Use reactive getter so position updates when viewport changes
		const xPercent = () => {
			const xPositionMs = (connector.xPercent / 100) * props.totalDurationMs;
			return timeToViewportPosition(xPositionMs, props.viewport) * 100;
		};

		return (
			<div
				class="absolute w-px bg-gray-400"
				style={{
					left: `${xPercent()}%`,
					top: `${topPx}px`,
					height: `${heightPx}px`,
				}}
			/>
		);
	};

	const containerHeight = () => packedStepsResult().totalRows * ROW_HEIGHT;

	return (
		<div class="h-full flex flex-col bg-gray-50 overflow-hidden">
			<div class="flex-shrink-0 px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
				Steps Timeline
			</div>
			<div class="flex-1 overflow-y-auto overflow-x-hidden p-3">
				<div class="relative" style={{ height: `${containerHeight()}px` }}>
					{/* Render connector lines first (behind spans) */}
					<For each={visibleConnectors()}>
						{(connector) => renderConnector(connector)}
					</For>
					{/* Render steps on top */}
					<For each={visibleSteps()}>{(step) => renderStep(step)}</For>
				</div>
			</div>
		</div>
	);
}

/**
 * Color scheme for different span kinds based on OpenTelemetry semantics.
 */
function getSpanColor(kind: SpanKind): string {
	const baseColors: Record<SpanKind, { h: number; s: number; l: number }> = {
		server: { h: 200, s: 70, l: 50 }, // Blue for server
		client: { h: 280, s: 60, l: 55 }, // Purple for client
		producer: { h: 160, s: 60, l: 45 }, // Teal for producer
		consumer: { h: 35, s: 70, l: 50 }, // Orange for consumer
		internal: { h: 100, s: 50, l: 45 }, // Green for internal
	};
	const base = baseColors[kind];
	return `hsl(${base.h}, ${base.s}%, ${base.l}%)`;
}

interface SpansPanelProps {
	spans: Span[];
	totalDurationMs: number;
	viewport: TimelineViewport;
	onSpanHover?: (spanId: string | null) => void;
}

function SpansPanel(props: SpansPanelProps) {
	// Convert and pack spans
	const packedSpansResult = createMemo(() => {
		const spanInputs = spansToSpanInput(props.spans);
		return packSpans(spanInputs);
	});

	// Build a kind map for coloring
	const kindMap = createMemo(() => {
		const map = new Map<string, SpanKind>();
		for (const span of props.spans) {
			map.set(span.id, span.kind);
		}
		return map;
	});

	// Filter spans to those within the visible viewport
	const visibleSpans = createMemo(() => {
		return packedSpansResult().spans.filter((span) =>
			isTimeRangeVisible(
				span.startOffset,
				span.startOffset + span.duration,
				props.viewport,
			),
		);
	});

	// Generate connectors only for visible spans
	const visibleConnectors = createMemo(() => {
		const visibleIds = new Set(visibleSpans().map((s) => s.id));
		return generateConnectors(
			packedSpansResult().spans,
			props.totalDurationMs,
		).filter((c) => visibleIds.has(c.parentId) || visibleIds.has(c.childId));
	});

	const renderSpan = (packedSpan: PackedSpan): JSX.Element => {
		// Use reactive getters so positions update when viewport changes
		const leftPercent = () =>
			timeToViewportPosition(packedSpan.startOffset, props.viewport) * 100;
		const rightPercent = () =>
			timeToViewportPosition(
				packedSpan.startOffset + packedSpan.duration,
				props.viewport,
			) * 100;
		const widthPercent = () => rightPercent() - leftPercent();
		const kind = kindMap().get(packedSpan.id) ?? "internal";

		return (
			// biome-ignore lint/a11y/noStaticElementInteractions: hover tracking for scroll-to-span feature
			<div
				class="absolute h-6 rounded text-xs flex items-center px-2 text-white truncate cursor-pointer hover:brightness-110"
				style={{
					left: `${leftPercent()}%`,
					width: `${Math.max(widthPercent(), 2)}%`,
					top: `${packedSpan.row * ROW_HEIGHT}px`,
					"background-color": getSpanColor(kind),
				}}
				title={`${packedSpan.name} (${packedSpan.duration}ms)`}
				onMouseEnter={() => props.onSpanHover?.(packedSpan.id)}
				onMouseLeave={() => props.onSpanHover?.(null)}
			>
				{packedSpan.name}
			</div>
		);
	};

	const renderConnector = (connector: SpanConnector): JSX.Element => {
		const rowDiff = connector.childRow - connector.parentRow;
		// Vertical line from bottom of parent row to top of child row
		const topPx = connector.parentRow * ROW_HEIGHT + 24; // Start just below parent span (24px = 6 row height)
		const heightPx = (rowDiff - 1) * ROW_HEIGHT + 4; // Connect to child span

		// Use reactive getter so position updates when viewport changes
		const xPercent = () => {
			const xPositionMs = (connector.xPercent / 100) * props.totalDurationMs;
			return timeToViewportPosition(xPositionMs, props.viewport) * 100;
		};

		return (
			<div
				class="absolute w-px bg-gray-400"
				style={{
					left: `${xPercent()}%`,
					top: `${topPx}px`,
					height: `${heightPx}px`,
				}}
			/>
		);
	};

	const containerHeight = () => packedSpansResult().totalRows * ROW_HEIGHT;

	return (
		<div class="h-full flex flex-col bg-gray-50 overflow-hidden">
			<div class="flex-shrink-0 px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
				Spans
			</div>
			<div class="flex-1 overflow-y-auto overflow-x-hidden p-3">
				<div class="relative" style={{ height: `${containerHeight()}px` }}>
					{/* Render connector lines first (behind spans) */}
					<For each={visibleConnectors()}>
						{(connector) => renderConnector(connector)}
					</For>
					{/* Render spans on top */}
					<For each={visibleSpans()}>
						{(packedSpan) => renderSpan(packedSpan)}
					</For>
				</div>
			</div>
		</div>
	);
}

interface DetailsPanelProps {
	traceInfo: TraceInfo;
	hoveredElements: HoveredElements | null;
	testStartTimeMs: number;
	/** Element to scroll into view (from hover/lock tracking) */
	focusedElement: FocusedElement | null;
}

/** Debounce delay for scroll-to-element (prevents jitter during rapid hover changes) */
const SCROLL_DEBOUNCE_MS = 50;

function DetailsPanel(props: DetailsPanelProps) {
	let containerRef: HTMLDivElement | undefined;

	// Flatten the hierarchical spans for rendering
	const flatSteps = () =>
		props.hoveredElements
			? flattenHoveredSpans(props.hoveredElements.steps)
			: [];
	const flatSpans = () =>
		props.hoveredElements
			? flattenHoveredSpans(props.hoveredElements.spans)
			: [];

	// Check if a span is the currently focused element
	const isSpanFocused = (spanId: string): boolean => {
		const focused = props.focusedElement;
		return !!(
			focused &&
			(focused.type === "step" || focused.type === "span") &&
			focused.id === spanId
		);
	};

	// Check if screenshot is focused
	const isScreenshotFocused = () => {
		const focused = props.focusedElement;
		return focused?.type === "screenshot";
	};

	// Scroll to focused element when it changes (with debounce to prevent jitter)
	createEffect(() => {
		const focused = props.focusedElement;
		if (!focused || !containerRef) return;

		let selector: string;
		if (focused.type === "screenshot") {
			selector = "[data-screenshot]";
		} else {
			// For steps and spans, use the span ID
			selector = `[data-span-id="${focused.id}"]`;
		}

		// Debounce scroll to avoid jitter during rapid hover transitions
		const timeout = setTimeout(() => {
			const element = containerRef?.querySelector(selector);
			if (element) {
				element.scrollIntoView({ behavior: "instant", block: "nearest" });
			}
		}, SCROLL_DEBOUNCE_MS);

		onCleanup(() => clearTimeout(timeout));
	});

	return (
		<div ref={containerRef} class="h-full overflow-auto bg-white">
			<Show
				when={props.hoveredElements}
				fallback={
					<div class="h-full flex items-center justify-center text-gray-400 text-sm">
						Hover over the timeline to see details
					</div>
				}
			>
				{(elements) => (
					<div class="p-4 space-y-6">
						{/* Screenshot at the top */}
						<Show when={elements().screenshot}>
							{(screenshot) => (
								<div
									data-screenshot
									class="bg-gray-100 rounded-lg overflow-hidden border-2 transition-colors duration-150"
									classList={{
										"border-blue-500 ring-2 ring-blue-200":
											isScreenshotFocused(),
										"border-gray-200": !isScreenshotFocused(),
									}}
								>
									<img
										src={screenshot().url}
										alt="Screenshot at hover time"
										class="w-full h-auto"
									/>
								</div>
							)}
						</Show>

						{/* Steps section */}
						<Show when={flatSteps().length > 0}>
							<div>
								<div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
									Steps ({flatSteps().length})
								</div>
								<div class="space-y-2">
									<For each={flatSteps()}>
										{(hoveredSpan) => (
											<SpanDetails
												hoveredSpan={hoveredSpan}
												testStartTimeMs={props.testStartTimeMs}
												colorFn={(depth) =>
													`hsl(${210 + depth * 30}, 70%, ${55 + depth * 5}%)`
												}
												isFocused={isSpanFocused(hoveredSpan.span.id)}
											/>
										)}
									</For>
								</div>
							</div>
						</Show>

						{/* Spans section */}
						<Show when={flatSpans().length > 0}>
							<div>
								<div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
									Spans ({flatSpans().length})
								</div>
								<div class="space-y-2">
									<For each={flatSpans()}>
										{(hoveredSpan) => (
											<SpanDetails
												hoveredSpan={hoveredSpan}
												testStartTimeMs={props.testStartTimeMs}
												colorFn={(_, span) => getSpanColor(span.kind)}
												isFocused={isSpanFocused(hoveredSpan.span.id)}
											/>
										)}
									</For>
								</div>
							</div>
						</Show>

						{/* Empty state when no steps or spans */}
						<Show when={flatSteps().length === 0 && flatSpans().length === 0}>
							<div class="text-gray-400 text-sm text-center py-4">
								No active steps or spans at this time
							</div>
						</Show>
					</div>
				)}
			</Show>
		</div>
	);
}

interface SpanDetailsProps {
	hoveredSpan: HoveredSpan;
	testStartTimeMs: number;
	colorFn: (depth: number, span: Span) => string;
	/** Whether this span is the currently focused element (for visual highlighting) */
	isFocused: boolean;
}

function SpanDetails(props: SpanDetailsProps) {
	const { span, depth } = props.hoveredSpan;
	const color = () => props.colorFn(depth, span);

	// Format timing info
	const startTimeDisplay = () => {
		const absoluteMs = props.testStartTimeMs + span.startOffsetMs;
		const absoluteDate = new Date(absoluteMs);
		const timeStr = absoluteDate.toLocaleTimeString("en-US", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		const msStr = String(absoluteMs % 1000).padStart(3, "0");
		return `${timeStr}.${msStr} (${formatDuration(span.startOffsetMs)} from start)`;
	};

	const endTimeDisplay = () => {
		const endOffsetMs = span.startOffsetMs + span.durationMs;
		const absoluteMs = props.testStartTimeMs + endOffsetMs;
		const absoluteDate = new Date(absoluteMs);
		const timeStr = absoluteDate.toLocaleTimeString("en-US", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		const msStr = String(absoluteMs % 1000).padStart(3, "0");
		return `${timeStr}.${msStr} (${formatDuration(endOffsetMs)} from start)`;
	};

	// Get attributes as entries, filtering out title attributes since we show title separately
	const attributeEntries = () => {
		return Object.entries(span.attributes).filter(
			([key]) => key !== "test.step.title" && key !== "test.case.title",
		);
	};

	return (
		<div
			data-span-id={span.id}
			class="rounded-lg border-2 overflow-hidden transition-all duration-150"
			classList={{
				"ring-2 ring-blue-200": props.isFocused,
			}}
			style={{
				"margin-left": `${depth * 12}px`,
				"border-color": props.isFocused ? "#3b82f6" : color(),
			}}
		>
			{/* Header with span name and color indicator */}
			<div
				class="px-3 py-2 text-white text-sm font-medium"
				style={{ "background-color": color() }}
			>
				{span.title}
			</div>

			{/* Details */}
			<div class="bg-gray-50 px-3 py-2 space-y-2 text-xs">
				{/* Timing info */}
				<div class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
					<span class="text-gray-500">Duration:</span>
					<span class="font-mono text-gray-900">
						{formatDuration(span.durationMs)}
					</span>

					<span class="text-gray-500">Start:</span>
					<span class="font-mono text-gray-900">{startTimeDisplay()}</span>

					<span class="text-gray-500">End:</span>
					<span class="font-mono text-gray-900">{endTimeDisplay()}</span>

					<span class="text-gray-500">Kind:</span>
					<span class="text-gray-900 capitalize">{span.kind}</span>

					<Show when={span.name !== span.title}>
						<span class="text-gray-500">Span Name:</span>
						<span class="font-mono text-gray-900">{span.name}</span>
					</Show>
				</div>

				{/* Attributes */}
				<Show when={attributeEntries().length > 0}>
					<div class="border-t border-gray-200 pt-2 mt-2">
						<div class="text-gray-500 mb-1">Attributes:</div>
						<div class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 pl-2">
							<For each={attributeEntries()}>
								{([key, value]) => (
									<>
										<span class="text-gray-500 truncate" title={key}>
											{key}:
										</span>
										<span
											class="font-mono text-gray-900 break-all"
											title={String(value)}
										>
											{formatAttributeValue(value)}
										</span>
									</>
								)}
							</For>
						</div>
					</div>
				</Show>
			</div>
		</div>
	);
}

/**
 * Formats a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
	if (ms < 1) {
		return `${(ms * 1000).toFixed(0)}µs`;
	}
	if (ms < 1000) {
		return `${ms.toFixed(1)}ms`;
	}
	if (ms < 60000) {
		return `${(ms / 1000).toFixed(2)}s`;
	}
	const minutes = Math.floor(ms / 60000);
	const seconds = ((ms % 60000) / 1000).toFixed(1);
	return `${minutes}m ${seconds}s`;
}

/**
 * Formats an attribute value for display.
 */
function formatAttributeValue(value: string | number | boolean): string {
	if (typeof value === "boolean") {
		return value ? "true" : "false";
	}
	if (typeof value === "number") {
		return String(value);
	}
	// Truncate very long strings
	if (value.length > 200) {
		return `${value.slice(0, 200)}...`;
	}
	return value;
}
