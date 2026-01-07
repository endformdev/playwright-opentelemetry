import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { useTraceDataLoader } from "../trace-data-loader/useTraceDataLoader";
import type { TraceInfo } from "../trace-info-loader";
import { BrowserSpansPanel } from "./components/BrowserSpansPanel";
import { DetailsPanel } from "./components/DetailsPanel";
import { ExternalSpansPanel } from "./components/ExternalSpansPanel";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { PanelHeader } from "./components/PanelHeader";
import { StepsTimeline } from "./components/StepsTimeline";
import { HoverProvider } from "./contexts/HoverContext";
import { SearchProvider, useSearch } from "./contexts/SearchContext";
import {
	useViewportContext,
	ViewportProvider,
} from "./contexts/ViewportContext";
import {
	detectTestPhases,
	getTestBodyPhase,
	type TestPhase,
} from "./detectTestPhases";
import { getElementsAtTime, type HoveredElements } from "./getElementsAtTime";
import { MultiResizablePanel } from "./MultiResizablePanel";
import { packSpans, type SpanInput } from "./packSpans";
import { calculateDepthBasedSizes } from "./panelSizing";
import { ResizablePanel } from "./ResizablePanel";
import { ScreenshotFilmstrip } from "./ScreenshotFilmstrip";
import { TimelineRuler } from "./TimelineRuler";
import { TraceViewerHeader } from "./TraceViewerHeader";
import {
	isTimeRangeVisible,
	type TimelineViewport,
	timeToViewportPosition,
	viewportPositionToTime,
} from "./viewport";

export interface TraceViewerProps {
	traceInfo: TraceInfo;
}

type FocusedElementType = "screenshot" | "step" | "span";

interface FocusedElement {
	type: FocusedElementType;
	id: string; // span ID for steps/spans, or screenshot URL for screenshots
}

/** Section identifiers for the main timeline panels */
type SectionId = "screenshots" | "steps" | "browser" | "external";

interface DisabledSection {
	id: SectionId;
	title: string;
	tooltip: string;
}

/** Panel size configuration (without content - content rendered separately) */
interface PanelSizeConfig {
	id: string;
	initialSize: number;
	minSize: number;
}

const SECTION_TITLES: Record<SectionId, string> = {
	screenshots: "Screenshots",
	steps: "Steps Timeline",
	browser: "Browser Spans",
	external: "External Spans",
};

const SECTION_TOOLTIPS: Record<SectionId, string> = {
	screenshots: "No screenshots were captured during this test",
	steps: "No test steps were recorded",
	browser: "No browser spans were captured",
	external: "No external spans were captured",
};

const PAN_SENSITIVITY = 0.2;
const ZOOM_SENSITIVITY = 0.005;
const LOCK_WINDOW_PX = 50;

/** Convert spans to SpanInput format for depth calculation */
function spansToSpanInput(
	spans: Array<{
		id: string;
		title: string;
		startOffsetMs: number;
		durationMs: number;
		parentId: string | null;
	}>,
): SpanInput[] {
	return spans.map((span) => ({
		id: span.id,
		name: span.title,
		startOffset: span.startOffsetMs,
		duration: span.durationMs,
		parentId: span.parentId,
	}));
}

export function TraceViewer(props: TraceViewerProps) {
	const traceData = useTraceDataLoader(() => props.traceInfo);
	const durationMs = () => traceData.totalDurationMs();

	const testStartTimeMs = () => {
		const startNano = BigInt(props.traceInfo.testInfo.startTimeUnixNano);
		return Number(startNano / BigInt(1_000_000));
	};

	return (
		<ViewportProvider durationMs={durationMs} testStartTimeMs={testStartTimeMs}>
			<SearchProvider
				spans={() => [
					...traceData.steps(),
					...traceData.browserSpans(),
					...traceData.externalSpans(),
				]}
			>
				<HoverProvider
					steps={() => traceData.steps()}
					spans={() => [
						...traceData.browserSpans(),
						...traceData.externalSpans(),
					]}
					screenshots={props.traceInfo.screenshots}
					testStartTimeMs={testStartTimeMs}
				>
					<TraceViewerInner
						traceInfo={props.traceInfo}
						traceData={traceData}
						testStartTimeMs={testStartTimeMs}
					/>
				</HoverProvider>
			</SearchProvider>
		</ViewportProvider>
	);
}

interface TraceViewerInnerProps {
	traceInfo: TraceInfo;
	traceData: ReturnType<typeof useTraceDataLoader>;
	testStartTimeMs: () => number;
}

function TraceViewerInner(props: TraceViewerInnerProps) {
	const { viewport, setViewport, zoomToRange, pan, zoom, reset } =
		useViewportContext();

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
	const [hoveredSearchSpanId, setHoveredSearchSpanId] = createSignal<
		string | null
	>(null);

	let contentAreaRef: HTMLDivElement | undefined;
	const stepsDepth = createMemo(() => {
		const steps = props.traceData.steps();
		if (steps.length === 0) return 0;
		return packSpans(spansToSpanInput(steps)).totalRows;
	});

	const browserDepth = createMemo(() => {
		const spans = props.traceData.browserSpans();
		if (spans.length === 0) return 0;
		return packSpans(spansToSpanInput(spans)).totalRows;
	});

	const externalDepth = createMemo(() => {
		const spans = props.traceData.externalSpans();
		if (spans.length === 0) return 0;
		return packSpans(spansToSpanInput(spans)).totalRows;
	});

	// Determine which sections are active/disabled
	const hasScreenshots = () => props.traceInfo.screenshots.length > 0;
	const hasSteps = () => stepsDepth() > 0;
	const hasBrowserSpans = () => browserDepth() > 0;
	const hasExternalSpans = () => externalDepth() > 0;

	// Get list of disabled sections for the footer
	const disabledSections = createMemo((): DisabledSection[] => {
		const sections: DisabledSection[] = [];
		if (!hasScreenshots()) {
			sections.push({
				id: "screenshots",
				title: SECTION_TITLES.screenshots,
				tooltip: SECTION_TOOLTIPS.screenshots,
			});
		}
		if (!hasSteps()) {
			sections.push({
				id: "steps",
				title: SECTION_TITLES.steps,
				tooltip: SECTION_TOOLTIPS.steps,
			});
		}
		if (!hasBrowserSpans()) {
			sections.push({
				id: "browser",
				title: SECTION_TITLES.browser,
				tooltip: SECTION_TOOLTIPS.browser,
			});
		}
		if (!hasExternalSpans()) {
			sections.push({
				id: "external",
				title: SECTION_TITLES.external,
				tooltip: SECTION_TOOLTIPS.external,
			});
		}
		return sections;
	});

	// Detect test phases (before hooks, test body, after hooks) for the phase indicator bar
	const testPhases = createMemo(() =>
		detectTestPhases(props.traceData.steps()),
	);

	// Track whether we've done the initial zoom
	const [hasInitialZoom, setHasInitialZoom] = createSignal(false);

	// Auto-zoom to test body on initial load when phases are detected
	createEffect(() => {
		// Wait for loading to complete
		if (props.traceData.isLoading()) return;

		// Only do this once
		if (hasInitialZoom()) return;

		const phases = testPhases();
		if (!phases) return;

		const testBody = getTestBodyPhase(phases);
		if (testBody) {
			// Zoom to test body with some padding
			zoomToRange(testBody.startMs, testBody.endMs);
			setHasInitialZoom(true);
		}
	});

	// Handle phase click - zoom to the clicked phase
	const handlePhaseClick = (phase: TestPhase) => {
		zoomToRange(phase.startMs, phase.endMs);
	};

	// Calculate depth-based sizes for span panels (just the sizing data, not content)
	const spanPanelSizeConfigs = createMemo((): PanelSizeConfig[] => {
		const sizes = calculateDepthBasedSizes({
			stepsDepth: stepsDepth(),
			browserDepth: browserDepth(),
			externalDepth: externalDepth(),
		});
		const configs: PanelSizeConfig[] = [];

		if (hasSteps() && sizes.steps !== undefined) {
			configs.push({
				id: "steps",
				initialSize: sizes.steps,
				minSize: 15,
			});
		}

		if (hasBrowserSpans() && sizes.browser !== undefined) {
			configs.push({
				id: "browser",
				initialSize: sizes.browser,
				minSize: 15,
			});
		}

		if (hasExternalSpans() && sizes.external !== undefined) {
			configs.push({
				id: "external",
				initialSize: sizes.external,
				minSize: 15,
			});
		}

		return configs;
	});

	// Check if we have any active span panels
	const hasAnySpanPanels = () => spanPanelSizeConfigs().length > 0;

	const handleMouseDown = (e: MouseEvent) => {
		// Only start selection on primary button
		if (e.button !== 0) return;
		if (!contentAreaRef) return;

		// Don't start selection if clicking on resize handles
		const target = e.target as HTMLElement;
		const computedStyle = window.getComputedStyle(target);
		if (
			computedStyle.cursor === "col-resize" ||
			computedStyle.cursor === "row-resize"
		) {
			return;
		}

		const rect = contentAreaRef.getBoundingClientRect();
		const position = (e.clientX - rect.left) / rect.width;

		if (position >= 0 && position <= 1) {
			setSelectionState({ startPosition: position, currentPosition: position });
		}
	};

	const handleMouseMove = (e: MouseEvent) => {
		if (!contentAreaRef) return;

		const rect = contentAreaRef.getBoundingClientRect();
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
				zoomToRange(startMs, endMs);
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
		if (!contentAreaRef) return;

		// Check for zoom modifier keys (Cmd, Ctrl, or Shift)
		const isZoomModifier = e.metaKey || e.ctrlKey || e.shiftKey;

		if (isZoomModifier && e.deltaY !== 0) {
			e.preventDefault();

			const rect = contentAreaRef.getBoundingClientRect();
			const focalPosition = Math.max(
				0,
				Math.min(1, (e.clientX - rect.left) / rect.width),
			);

			// Negative deltaY (scroll up) = zoom in (positive zoomDelta)
			const zoomDelta = -e.deltaY * ZOOM_SENSITIVITY;
			zoom(focalPosition, zoomDelta);
			return;
		}

		const isHorizontalScroll = Math.abs(e.deltaX) > Math.abs(e.deltaY);

		if (isHorizontalScroll) {
			e.preventDefault();

			const visibleDuration =
				viewport().visibleEndMs - viewport().visibleStartMs;
			const panDeltaMs = (e.deltaX * PAN_SENSITIVITY * visibleDuration) / 100;
			pan(panDeltaMs);
		}
	};

	const handleDoubleClick = () => {
		setLockedPosition(null);
		setLockedElement(null);
		reset();
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

	const handleSpanSelect = (spanId: string) => {
		// Find the span to get its start time
		const allSpans = [
			...props.traceData.steps(),
			...props.traceData.browserSpans(),
			...props.traceData.externalSpans(),
		];
		const span = allSpans.find((s) => s.id === spanId);

		if (span) {
			const position = timeToViewportPosition(span.startOffsetMs, viewport());
			const clampedPosition = Math.max(0, Math.min(1, position));

			setLockedPosition(clampedPosition);

			const isStep =
				span.name === "playwright.test" || span.name === "playwright.test.step";
			setLockedElement({
				type: isStep ? "step" : "span",
				id: spanId,
			});
		}
	};

	const handleSearchResultHover = (spanId: string | null) => {
		// Track which span is being hovered in search results
		setHoveredSearchSpanId(spanId);

		if (!spanId) {
			// Clear hover state - will snap back to locked if locked, or show nothing
			setHoverPosition(null);
			setHoveredElement(null);
			return;
		}

		// Find the span
		const allSpans = [
			...props.traceData.steps(),
			...props.traceData.browserSpans(),
			...props.traceData.externalSpans(),
		];
		const span = allSpans.find((s) => s.id === spanId);

		if (span) {
			// Check if span is visible in current viewport
			const isVisible = isTimeRangeVisible(
				span.startOffsetMs,
				span.startOffsetMs + span.durationMs,
				viewport(),
			);

			if (isVisible) {
				// Set hover position to span start time
				const position = timeToViewportPosition(span.startOffsetMs, viewport());
				setHoverPosition(Math.max(0, Math.min(1, position)));
			}
			// Always set hovered element so details panel scrolls to it
			const isStep =
				span.name === "playwright.test" || span.name === "playwright.test.step";
			setHoveredElement({
				type: isStep ? "step" : "span",
				id: spanId,
			});
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
		if (locked === null || hover === null || !contentAreaRef) return false;

		const panelWidth = contentAreaRef.getBoundingClientRect().width;
		const lockedPx = locked * panelWidth;
		const hoverPx = hover * panelWidth;
		return Math.abs(hoverPx - lockedPx) <= LOCK_WINDOW_PX;
	};

	const hoveredElements = createMemo((): HoveredElements | null => {
		const timeMs = hoverTimeMs();
		if (timeMs === null) return null;
		return getElementsAtTime(
			timeMs,
			props.traceData.steps(),
			[...props.traceData.browserSpans(), ...props.traceData.externalSpans()],
			props.traceInfo.screenshots,
			props.testStartTimeMs(),
		);
	});

	const lockedElements = createMemo((): HoveredElements | null => {
		const timeMs = lockedTimeMs();
		if (timeMs === null) return null;
		return getElementsAtTime(
			timeMs,
			props.traceData.steps(),
			[...props.traceData.browserSpans(), ...props.traceData.externalSpans()],
			props.traceInfo.screenshots,
			props.testStartTimeMs(),
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

	const SpanPanelsContent = () => {
		const search = useSearch();

		// Create a wrapper component for each panel that will reactively update
		const renderPanelContent = (panelId: string) => {
			switch (panelId) {
				case "steps":
					return (
						<StepsTimeline
							steps={props.traceData.steps()}
							onStepHover={handleStepHover}
							matchedSpanIds={search.matchedSpanIds()}
							hoveredSearchSpanId={hoveredSearchSpanId()}
						/>
					);
				case "browser":
					return (
						<BrowserSpansPanel
							spans={props.traceData.browserSpans()}
							onSpanHover={handleSpanHover}
							matchedSpanIds={search.matchedSpanIds()}
							hoveredSearchSpanId={hoveredSearchSpanId()}
						/>
					);
				case "external":
					return (
						<ExternalSpansPanel
							spans={props.traceData.externalSpans()}
							onSpanHover={handleSpanHover}
							matchedSpanIds={search.matchedSpanIds()}
							hoveredSearchSpanId={hoveredSearchSpanId()}
						/>
					);
				default:
					return null;
			}
		};

		const configs = spanPanelSizeConfigs().map((config) => ({
			...config,
			content: renderPanelContent(config.id),
		}));

		if (configs.length === 0) {
			return null;
		}

		if (configs.length === 1) {
			return <div class="h-full">{configs[0].content}</div>;
		}

		return <MultiResizablePanel direction="vertical" panels={configs} />;
	};

	const MainPanelContent = () => (
		<div class="flex flex-col h-full relative">
			<Show when={props.traceData.isLoading()}>
				<LoadingOverlay
					loaded={props.traceData.progress().loaded}
					total={props.traceData.progress().total}
				/>
			</Show>

			<TimelineRuler
				durationMs={props.traceData.totalDurationMs()}
				viewport={viewport()}
				hoverPosition={hoverPosition()}
				onViewportChange={handleViewportChange}
				testPhases={testPhases()}
				onPhaseClick={handlePhaseClick}
				onDoubleClick={handleDoubleClick}
			/>

			<div
				ref={contentAreaRef}
				class="flex-1 min-h-0 relative flex flex-col"
				style={{ cursor: selectionState() ? "crosshair" : undefined }}
				onMouseDown={handleMouseDown}
				onMouseMove={handleMouseMove}
				onMouseLeave={handleMouseLeave}
				onWheel={handleWheel}
				onDblClick={handleDoubleClick}
			>
				{/* Active panels section */}
				<div class="flex-1 min-h-0">
					<Show
						when={hasScreenshots() && hasAnySpanPanels()}
						fallback={
							<Show
								when={hasScreenshots()}
								fallback={
									<Show when={hasAnySpanPanels()}>
										<SpanPanelsContent />
									</Show>
								}
							>
								{/* Only screenshots active */}
								<ScreenshotFilmstrip
									screenshots={props.traceInfo.screenshots}
									viewport={viewport()}
									testStartTimeMs={props.testStartTimeMs()}
									onScreenshotHover={handleScreenshotHover}
								/>
							</Show>
						}
					>
						{/* Both screenshots and span panels active */}
						<ResizablePanel
							direction="vertical"
							initialFirstPanelSize={12}
							minFirstPanelSize={7}
							maxFirstPanelSize={40}
							firstPanel={
								<ScreenshotFilmstrip
									screenshots={props.traceInfo.screenshots}
									viewport={viewport()}
									testStartTimeMs={props.testStartTimeMs()}
									onScreenshotHover={handleScreenshotHover}
								/>
							}
							secondPanel={<SpanPanelsContent />}
						/>
					</Show>
				</div>

				{/* Disabled sections footer */}
				<Show when={disabledSections().length > 0}>
					<div class="flex-shrink-0 border-t border-gray-300">
						<For each={disabledSections()}>
							{(section) => (
								<PanelHeader
									title={section.title}
									disabled={true}
									disabledTooltip={section.tooltip}
								/>
							)}
						</For>
					</div>
				</Show>

				{/* Selection overlay */}
				<Show when={selectionState()}>
					<div
						class="absolute top-0 bottom-0 bg-blue-500/20 border-x-2 border-blue-500 pointer-events-none z-40"
						style={{
							left: `${selectionLeft()}%`,
							width: `${selectionWidth()}%`,
						}}
					/>
				</Show>

				{/* Locked position indicator */}
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

				{/* Hover position indicator (when locked and outside lock window) */}
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

				{/* Hover position indicator (when not locked) */}
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
				onSpanSelect={handleSpanSelect}
				onSpanHover={handleSearchResultHover}
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
							testStartTimeMs={props.testStartTimeMs()}
							focusedElement={displayFocusedElement()}
						/>
					}
				/>
			</div>
		</div>
	);
}
