import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import type { Span, SpanKind } from "../trace-data-loader/exportToSpans";
import { useTraceDataLoader } from "../trace-data-loader/useTraceDataLoader";
import type { TraceInfo } from "../trace-info-loader";
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
	zoomViewport,
} from "./viewport";

export interface TraceViewerProps {
	traceInfo: TraceInfo;
}

/** Zoom sensitivity for scroll wheel (higher = faster zoom) */
const ZOOM_SENSITIVITY = 0.002;

/** Pan sensitivity for horizontal scroll (higher = faster pan) */
const PAN_SENSITIVITY = 0.2;

/** Row height in pixels for the packed layout */
const ROW_HEIGHT = 28;

export function TraceViewer(props: TraceViewerProps) {
	// Load trace data using the hook
	const traceData = useTraceDataLoader(() => props.traceInfo);

	// Use duration from trace data loader
	const durationMs = () => traceData.totalDurationMs();

	// Calculate test start time in milliseconds (for converting absolute timestamps to relative)
	const testStartTimeMs = () => {
		const startNano = BigInt(props.traceInfo.testInfo.startTimeUnixNano);
		return Number(startNano / BigInt(1_000_000));
	};

	// Viewport state for zoom/pan - recreate when duration changes
	const [viewport, setViewport] = createSignal<TimelineViewport>(
		createViewport(durationMs() || 1000),
	);

	// Update viewport when duration changes (after loading completes)
	createMemo(() => {
		const duration = durationMs();
		if (duration > 0) {
			setViewport(createViewport(duration));
		}
	});

	// Shared hover position state (0-1 percentage in viewport space, or null when not hovering)
	const [hoverPosition, setHoverPosition] = createSignal<number | null>(null);

	let mainPanelRef: HTMLDivElement | undefined;

	const handleMouseMove = (e: MouseEvent) => {
		if (!mainPanelRef) return;

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

		const rect = mainPanelRef.getBoundingClientRect();
		const position = (e.clientX - rect.left) / rect.width;
		// Clamp to valid range
		if (position >= 0 && position <= 1) {
			setHoverPosition(position);
		} else {
			setHoverPosition(null);
		}
	};

	const handleMouseLeave = () => {
		setHoverPosition(null);
	};

	// Handle scroll wheel for zooming and horizontal panning
	const handleWheel = (e: WheelEvent) => {
		if (!mainPanelRef) return;

		// Prevent default scroll behavior
		e.preventDefault();

		// Check if this is a horizontal scroll (shift+wheel or trackpad horizontal gesture)
		const isHorizontalScroll = Math.abs(e.deltaX) > Math.abs(e.deltaY);

		if (isHorizontalScroll) {
			// Horizontal scroll = pan left/right
			const visibleDuration =
				viewport().visibleEndMs - viewport().visibleStartMs;
			// deltaX > 0 = scroll right = pan right (move viewport forward in time)
			const panDeltaMs = (e.deltaX * PAN_SENSITIVITY * visibleDuration) / 100;
			setViewport((v) => panViewport(v, panDeltaMs));
		} else {
			// Vertical scroll = zoom in/out
			const rect = mainPanelRef.getBoundingClientRect();
			const focalPosition = (e.clientX - rect.left) / rect.width;

			// Clamp focal position to valid range
			const clampedFocalPosition = Math.max(0, Math.min(1, focalPosition));

			// deltaY > 0 = scroll down = zoom out, deltaY < 0 = scroll up = zoom in
			const zoomDelta = -e.deltaY * ZOOM_SENSITIVITY;

			setViewport((v) => zoomViewport(v, clampedFocalPosition, zoomDelta));
		}
	};

	// Handle double-click to reset zoom
	const handleDoubleClick = () => {
		setViewport((v) => resetViewport(v));
	};

	// Convert hover position (0-1 in viewport space) to time in milliseconds
	const hoverTimeMs = () => {
		const pos = hoverPosition();
		if (pos === null) return null;
		return viewportPositionToTime(pos, viewport());
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

	// Main Panel content (with fixed timeline ruler + vertical splits for Screenshot, Steps, Spans)
	const mainPanelContent = (
		// biome-ignore lint/a11y/noStaticElementInteractions: container needs mouse tracking for hover line
		<div
			ref={mainPanelRef}
			class="flex flex-col h-full relative"
			onMouseMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
			onWheel={handleWheel}
			onDblClick={handleDoubleClick}
		>
			{/* Loading overlay */}
			{loadingOverlay()}

			{/* Fixed height timeline ruler at the top - always shows full duration */}
			{/* Ruler has its own hover indicator showing position on total timeline */}
			<TimelineRuler
				durationMs={durationMs()}
				viewport={viewport()}
				hoverPosition={hoverPosition()}
			/>

			{/* Remaining space for resizable panels - with hover line overlay */}
			<div class="flex-1 min-h-0 relative">
				<ResizablePanel
					direction="vertical"
					initialFirstPanelSize={20}
					minFirstPanelSize={10}
					maxFirstPanelSize={40}
					firstPanel={
						<ScreenshotFilmstrip
							screenshots={props.traceInfo.screenshots}
							viewport={viewport()}
							testStartTimeMs={testStartTimeMs()}
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
								/>
							}
							secondPanel={
								<SpansPanel
									spans={traceData.spans()}
									totalDurationMs={durationMs()}
									viewport={viewport()}
								/>
							}
						/>
					}
				/>

				{/* Hover line overlay for content area (excludes ruler) */}
				<Show when={hoverPosition()} keyed>
					{(pos) => (
						<div
							class="absolute top-0 bottom-0 w-px bg-blue-500 pointer-events-none z-50"
							style={{ left: `${pos * 100}%` }}
						/>
					)}
				</Show>
			</div>
		</div>
	);

	return (
		<div class="flex flex-col h-full w-full bg-white text-gray-900">
			<TraceViewerHeader
				testInfo={props.traceInfo.testInfo}
				hoverTimeMs={hoverTimeMs}
			/>

			{/* Resizable Main Content Area */}
			<div class="flex-1 min-h-0">
				<ResizablePanel
					direction="horizontal"
					initialFirstPanelSize={75}
					minFirstPanelSize={50}
					maxFirstPanelSize={90}
					firstPanel={mainPanelContent}
					secondPanel={<DetailsPanel traceInfo={props.traceInfo} />}
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
			<div
				class="absolute h-6 rounded text-xs flex items-center px-2 text-white truncate cursor-pointer hover:brightness-95"
				style={{
					left: `${leftPercent()}%`,
					width: `${Math.max(widthPercent(), 3)}%`,
					top: `${step.row * ROW_HEIGHT}px`,
					"background-color": `hsl(${210 + depth * 30}, 70%, ${55 + depth * 5}%)`,
				}}
				title={`${step.name} (${step.duration}ms)`}
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

	const renderSpan = (span: PackedSpan): JSX.Element => {
		// Use reactive getters so positions update when viewport changes
		const leftPercent = () =>
			timeToViewportPosition(span.startOffset, props.viewport) * 100;
		const rightPercent = () =>
			timeToViewportPosition(span.startOffset + span.duration, props.viewport) *
			100;
		const widthPercent = () => rightPercent() - leftPercent();
		const kind = kindMap().get(span.id) ?? "internal";

		return (
			<div
				class="absolute h-6 rounded text-xs flex items-center px-2 text-white truncate cursor-pointer hover:brightness-110"
				style={{
					left: `${leftPercent()}%`,
					width: `${Math.max(widthPercent(), 2)}%`,
					top: `${span.row * ROW_HEIGHT}px`,
					"background-color": getSpanColor(kind),
				}}
				title={`${span.name} (${span.duration}ms)`}
			>
				{span.name}
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
					<For each={visibleSpans()}>{(span) => renderSpan(span)}</For>
				</div>
			</div>
		</div>
	);
}

function DetailsPanel(_props: { traceInfo: TraceInfo }) {
	return (
		<div class="h-full flex flex-col bg-white">
			<div class="flex-shrink-0 px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
				Details
			</div>
			<div class="flex-1 overflow-auto p-3">
				<div class="text-gray-500 text-sm">
					<p class="mb-4">
						Select a step, screenshot, or trace to view details.
					</p>
					<div class="border border-gray-200 rounded p-3 bg-gray-50">
						<div class="text-xs text-gray-400 uppercase tracking-wide mb-2">
							Placeholder Content
						</div>
						<div class="space-y-2 text-xs">
							<div class="flex justify-between">
								<span class="text-gray-500">Type:</span>
								<span class="text-gray-700">-</span>
							</div>
							<div class="flex justify-between">
								<span class="text-gray-500">Duration:</span>
								<span class="text-gray-700">-</span>
							</div>
							<div class="flex justify-between">
								<span class="text-gray-500">Start Time:</span>
								<span class="text-gray-700">-</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
