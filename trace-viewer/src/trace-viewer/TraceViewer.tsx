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
import { isErrorSpan } from "../trace-data-loader/exportToSpans";
import type { ScreenshotInfo, TraceInfo } from "../trace-info-loader";
import { BrowserSpansPanel } from "./components/BrowserSpansPanel";
import { DetailsPanel } from "./components/DetailsPanel";
import { ExternalSpansPanel } from "./components/ExternalSpansPanel";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { PanelHeader } from "./components/PanelHeader";
import { ScreenshotViewer } from "./components/ScreenshotViewer";
import { StepsTimeline } from "./components/StepsTimeline";
import { HoverProvider, useHoverContext } from "./contexts/HoverContext";
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
import { MultiResizablePanel } from "./MultiResizablePanel";
import { calculateInitialPanelSizes } from "./panelSizing";
import { ResizablePanel } from "./ResizablePanel";
import { ScreenshotFilmstrip } from "./ScreenshotFilmstrip";
import {
	getSpanSelectionTimeMs,
	type SpanSelectionPlacement,
} from "./spanSelection";
import { TimelineRuler } from "./TimelineRuler";
import { TraceViewerHeader } from "./TraceViewerHeader";
import { ALL_VIEWER_PANELS, type ViewerPanels } from "./viewerPanels";
import {
	isTimeRangeVisible,
	type TimelineViewport,
	timeToViewportPosition,
	viewportPositionToTime,
} from "./viewport";

export interface TraceViewerProps {
	traceInfo: TraceInfo;
	/** Which regions to show. Defaults to every region. */
	panels?: ViewerPanels;
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
const MIN_SELECTION_DISPLAY_PERCENT = 1;
const SCREENSHOT_PANEL_ROW_SIZE_PERCENT = 12;
/** Initial height of the screenshot viewer when stacked above the details sidebar */
const SIDEBAR_VIEWER_INITIAL_SIZE_PERCENT = 40;
/** Initial height of the screenshot viewer when stacked above timeline span panels */
const MAIN_VIEWER_WITH_SPANS_INITIAL_SIZE_PERCENT = 50;
/** Initial height of the screenshot viewer when the timeline has no span panels (player layout) */
const MAIN_VIEWER_INITIAL_SIZE_PERCENT = 75;

function countScreenshotPages(screenshots: ScreenshotInfo[]): number {
	if (screenshots.length === 0) return 1;
	return new Set(screenshots.map((screenshot) => screenshot.pageId)).size;
}

function getDefaultVisibleScreenshotRows(rowCount: number): number {
	if (rowCount <= 1) return 1;
	if (rowCount === 2) return 2;
	return 2.5;
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
					screenshots={() =>
						props.traceInfo.screenshots.loading
							? []
							: (props.traceInfo.screenshots() ?? [])
					}
					testStartTimeMs={testStartTimeMs}
				>
					<TraceViewerInner
						traceInfo={props.traceInfo}
						traceData={traceData}
						testStartTimeMs={testStartTimeMs}
						panels={props.panels ?? ALL_VIEWER_PANELS}
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
	panels: ViewerPanels;
}

function TraceViewerInner(props: TraceViewerInnerProps) {
	const { viewport, setViewport, zoomToRange, pan, zoom, reset } =
		useViewportContext();

	const {
		mode,
		hoverPosition,
		setHoverPosition,
		lockedPosition,
		lockedTimeMs,
		lock,
		unlock,
		enterSearchOverride,
		exitSearchOverride,
		hoveredElement,
		setHoveredElement,
		lockedElement,
		displayTimeMs,
		displayElements,
		displayFocusedElement,
	} = useHoverContext();

	const [selectionState, setSelectionState] = createSignal<{
		startPosition: number;
		currentPosition: number;
	} | null>(null);
	const [hoveredSearchSpanId, setHoveredSearchSpanId] = createSignal<
		string | null
	>(null);
	const allSpans = createMemo(() => [
		...props.traceData.steps(),
		...props.traceData.browserSpans(),
		...props.traceData.externalSpans(),
	]);
	const errorSpans = createMemo(() =>
		allSpans()
			.filter(isErrorSpan)
			.sort((a, b) => a.startOffsetMs - b.startOffsetMs),
	);

	let contentAreaRef: HTMLDivElement | undefined;
	// Determine which sections are active/disabled. A section is shown when it
	// is enabled by the `panels` config AND the trace has data for it.
	const hasLoadedScreenshots = () =>
		(props.traceInfo.screenshots() ?? []).length > 0;
	const hasScreenshotData = () =>
		props.traceInfo.screenshots.loading || hasLoadedScreenshots();
	const hasScreenshots = () => props.panels.filmstrip && hasScreenshotData();
	const showScreenshotViewer = () => props.panels.viewer && hasScreenshotData();
	const screenshotPageCount = createMemo(() =>
		countScreenshotPages(props.traceInfo.screenshots() ?? []),
	);
	const screenshotPanelInitialSize = createMemo(
		() =>
			SCREENSHOT_PANEL_ROW_SIZE_PERCENT *
			getDefaultVisibleScreenshotRows(screenshotPageCount()),
	);
	const hasStepData = () => props.traceData.steps().length > 0;
	const hasBrowserSpanData = () => props.traceData.browserSpans().length > 0;
	const hasExternalSpanData = () => props.traceData.externalSpans().length > 0;
	const hasSteps = () => props.panels.steps && hasStepData();
	const hasBrowserSpans = () => props.panels.browser && hasBrowserSpanData();
	const hasExternalSpans = () => props.panels.external && hasExternalSpanData();

	// Sections that are enabled by config but have no data, shown in the footer
	const disabledSections = createMemo((): DisabledSection[] => {
		const sections: DisabledSection[] = [];
		if (
			props.panels.filmstrip &&
			!props.traceInfo.screenshots.loading &&
			!hasLoadedScreenshots()
		) {
			sections.push({
				id: "screenshots",
				title: SECTION_TITLES.screenshots,
				tooltip: SECTION_TOOLTIPS.screenshots,
			});
		}
		if (props.panels.steps && !hasStepData()) {
			sections.push({
				id: "steps",
				title: SECTION_TITLES.steps,
				tooltip: SECTION_TOOLTIPS.steps,
			});
		}
		if (props.panels.browser && !hasBrowserSpanData()) {
			sections.push({
				id: "browser",
				title: SECTION_TITLES.browser,
				tooltip: SECTION_TOOLTIPS.browser,
			});
		}
		if (props.panels.external && !hasExternalSpanData()) {
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

	// Calculate initial sizes for span panels (just the sizing data, not content)
	const spanPanelSizeConfigs = createMemo((): PanelSizeConfig[] => {
		const sizes = calculateInitialPanelSizes({
			steps: hasSteps(),
			browser: hasBrowserSpans(),
			external: hasExternalSpans(),
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

	const showTimelineColumn = () =>
		props.panels.ruler ||
		hasScreenshots() ||
		hasAnySpanPanels() ||
		disabledSections().length > 0;
	const showDetails = () => props.panels.details;
	// The screenshot viewer docks above the details sidebar when it is shown,
	// otherwise above the timeline column.
	const showViewerInSidebar = () => showScreenshotViewer() && showDetails();
	const showViewerInMain = () => showScreenshotViewer() && !showDetails();
	const showMainColumn = () => showTimelineColumn() || showViewerInMain();

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
			// Only update hover position in hover mode
			if (mode() === "hover") {
				setHoverPosition(null);
			}
			return;
		}

		// Only update hover position in hover mode
		if (mode() === "hover") {
			if (position >= 0 && position <= 1) {
				setHoverPosition(position);
			} else {
				setHoverPosition(null);
			}
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
				// This was a drag - zoom to selection (works in any mode, doesn't change mode)
				zoomToRange(startMs, endMs);
			} else {
				// This was a click (not a meaningful drag)
				const currentMode = mode();
				switch (currentMode) {
					case "hover":
						// Lock to the selected time so zooming does not move the lock.
						lock(
							viewportPositionToTime(selection.startPosition, viewport()),
							hoveredElement(),
						);
						break;
					case "locked":
					case "search-override":
						// Any click unlocks - set hover position to click location
						// so the hover line appears immediately
						setHoverPosition(selection.startPosition);
						unlock();
						break;
				}
			}

			setSelectionState(null);
		}
	};

	const handleMouseLeave = () => {
		if (mode() === "hover") {
			setHoverPosition(null);
		}
		// Don't clear selection on mouse leave - user might drag outside temporarily
	};

	// Set up global mouseup listener to handle drag end outside component
	onMount(() => {
		const onGlobalMouseUp = () => handleMouseUp();
		document.addEventListener("mouseup", onGlobalMouseUp);

		const onKeyDown = (e: KeyboardEvent) => {
			const currentMode = mode();
			if (e.key === "Escape" && currentMode !== "hover") {
				unlock();
			}
		};
		document.addEventListener("keydown", onKeyDown);

		onCleanup(() => {
			document.removeEventListener("mouseup", onGlobalMouseUp);
			document.removeEventListener("keydown", onKeyDown);
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
			const pointerPosition = Math.max(
				0,
				Math.min(1, (e.clientX - rect.left) / rect.width),
			);
			const lockPosition = mode() === "hover" ? null : lockedPosition();
			const focalPosition =
				lockPosition !== null && lockPosition >= 0 && lockPosition <= 1
					? lockPosition
					: pointerPosition;

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
		unlock();
		reset();
	};

	// We intentionally do NOT clear hoveredElement on mouseLeave (null).
	// The last hovered element persists until a new element is hovered or
	// the mouse leaves the main panel entirely.
	const handleScreenshotHover = (screenshotUrl: string | null) => {
		if (screenshotUrl && mode() === "hover") {
			setHoveredElement({ type: "screenshot", id: screenshotUrl });
		}
	};

	const handleStepHover = (stepId: string | null) => {
		if (stepId && mode() === "hover") {
			setHoveredElement({ type: "step", id: stepId });
		}
	};

	const handleSpanHover = (spanId: string | null) => {
		if (spanId && mode() === "hover") {
			setHoveredElement({ type: "span", id: spanId });
		}
	};

	const handleSpanSelect = (
		spanId: string,
		placement: SpanSelectionPlacement,
	) => {
		// Find the span to get its selected timeline position
		const span = allSpans().find((s) => s.id === spanId);

		if (span) {
			const selectionTimeMs = getSpanSelectionTimeMs(span, placement);
			const currentViewport = viewport();
			const selectionViewport = isTimeRangeVisible(
				span.startOffsetMs,
				span.startOffsetMs + span.durationMs,
				currentViewport,
			)
				? currentViewport
				: {
						visibleStartMs: 0,
						visibleEndMs: currentViewport.totalDurationMs,
						totalDurationMs: currentViewport.totalDurationMs,
					};

			if (selectionViewport !== currentViewport) {
				setViewport(selectionViewport);
			}

			const isStep =
				span.name === "playwright.test" || span.name === "playwright.test.step";
			lock(selectionTimeMs, {
				type: isStep ? "step" : "span",
				id: spanId,
			});
		}
	};

	// Navigate to a span without changing time position - only updates focus for scrolling
	const handleSpanNavigate = (spanId: string) => {
		const span = allSpans().find((s) => s.id === spanId);

		if (span) {
			const isStep =
				span.name === "playwright.test" || span.name === "playwright.test.step";

			// When navigating within locked mode, update the focused element while
			// preserving the locked time.
			const currentMode = mode();
			if (currentMode === "locked" || currentMode === "search-override") {
				// Re-lock at the current position but with the new element
				const timeMs = lockedTimeMs();
				if (timeMs !== null) {
					lock(timeMs, {
						type: isStep ? "step" : "span",
						id: spanId,
					});
				}
			}
		}
	};

	const handleSearchResultHover = (spanId: string | null) => {
		// Track which span is being hovered in search results
		setHoveredSearchSpanId(spanId);

		if (!spanId) {
			// Clearing search hover
			const currentMode = mode();
			if (currentMode === "search-override") {
				exitSearchOverride();
			}
			setHoverPosition(null);
			setHoveredElement(null);
			return;
		}

		// Entering search hover - enter search-override mode if locked
		const currentMode = mode();
		if (currentMode === "locked") {
			enterSearchOverride();
		}

		// Find the span
		const span = allSpans().find((s) => s.id === spanId);

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
			return (
				<div class="h-full min-h-0 overflow-hidden">{configs[0].content}</div>
			);
		}

		return <MultiResizablePanel direction="vertical" panels={configs} />;
	};

	const MainPanelContent = () => (
		<div class="flex flex-col h-full relative">
			<Show when={props.panels.ruler}>
				<TimelineRuler
					durationMs={props.traceData.totalDurationMs()}
					viewport={viewport()}
					hoverPosition={hoverPosition()}
					onViewportChange={handleViewportChange}
					testPhases={testPhases()}
					onPhaseClick={handlePhaseClick}
					onDoubleClick={handleDoubleClick}
				/>
			</Show>

			<div
				ref={contentAreaRef}
				class="flex-1 min-h-0 relative flex flex-col"
				role="region"
				aria-label="Trace timeline"
				style={{ cursor: selectionState() ? "crosshair" : undefined }}
				onMouseDown={handleMouseDown}
				onMouseMove={handleMouseMove}
				onMouseLeave={handleMouseLeave}
				onWheel={handleWheel}
				onDblClick={handleDoubleClick}
			>
				{/* Active panels section */}
				<div class="flex-1 min-h-0 overflow-hidden">
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
									previewEnabled={mode() === "hover"}
								/>
							</Show>
						}
					>
						{/* Both screenshots and span panels active */}
						<ResizablePanel
							direction="vertical"
							initialFirstPanelSize={screenshotPanelInitialSize()}
							minFirstPanelSize={7}
							maxFirstPanelSize={80}
							firstPanel={
								<ScreenshotFilmstrip
									screenshots={props.traceInfo.screenshots}
									viewport={viewport()}
									testStartTimeMs={props.testStartTimeMs()}
									onScreenshotHover={handleScreenshotHover}
									previewEnabled={mode() === "hover"}
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

				{/* Selection overlay - only show when selection is meaningful */}
				<Show
					when={
						selectionState() && selectionWidth() > MIN_SELECTION_DISPLAY_PERCENT
					}
				>
					<div
						class="absolute top-0 bottom-0 bg-blue-500/20 border-x-2 border-blue-500 pointer-events-none z-40"
						style={{
							left: `${selectionLeft()}%`,
							width: `${selectionWidth()}%`,
						}}
					/>
				</Show>

				{/* Position indicator - hover mode: thin blue line */}
				<Show when={mode() === "hover" && hoverPosition() !== null}>
					<div
						class="absolute top-0 bottom-0 w-px bg-blue-500 pointer-events-none z-50"
						style={{ left: `${hoverPosition()! * 100}%` }}
					/>
				</Show>

				{/* Position indicator - locked mode: thick blue line */}
				<Show when={mode() === "locked" && lockedPosition() !== null}>
					<div
						class="absolute top-0 bottom-0 bg-blue-600 pointer-events-none z-50"
						style={{
							left: `${lockedPosition()! * 100}%`,
							width: "3px",
							"margin-left": "-1px",
						}}
					/>
				</Show>

				{/* Position indicator - search-override mode: both lines */}
				<Show when={mode() === "search-override"}>
					{/* Locked position - thick blue line */}
					<Show when={lockedPosition() !== null}>
						<div
							class="absolute top-0 bottom-0 bg-blue-600 pointer-events-none z-50"
							style={{
								left: `${lockedPosition()! * 100}%`,
								width: "3px",
								"margin-left": "-1px",
							}}
						/>
					</Show>
					{/* Search hover position - thin lighter blue line */}
					<Show when={hoverPosition() !== null}>
						<div
							class="absolute top-0 bottom-0 w-px bg-blue-400 pointer-events-none z-45"
							style={{ left: `${hoverPosition()! * 100}%` }}
						/>
					</Show>
				</Show>
			</div>
		</div>
	);

	const ScreenshotViewerContent = () => (
		<ScreenshotViewer
			screenshot={
				displayElements() ? (displayElements()?.screenshot ?? null) : undefined
			}
			focused={displayFocusedElement()?.type === "screenshot"}
		/>
	);

	const DetailsPanelContent = () => (
		<DetailsPanel
			traceInfo={props.traceInfo}
			hoveredElements={displayElements()}
			testStartTimeMs={props.testStartTimeMs()}
			focusedElement={displayFocusedElement()}
			onNavigateToSpan={handleSpanNavigate}
		/>
	);

	const MainColumnContent = () => (
		<Show when={showViewerInMain()} fallback={<MainPanelContent />}>
			<Show when={showTimelineColumn()} fallback={<ScreenshotViewerContent />}>
				<ResizablePanel
					direction="vertical"
					initialFirstPanelSize={
						hasAnySpanPanels()
							? MAIN_VIEWER_WITH_SPANS_INITIAL_SIZE_PERCENT
							: MAIN_VIEWER_INITIAL_SIZE_PERCENT
					}
					minFirstPanelSize={10}
					maxFirstPanelSize={90}
					firstPanel={<ScreenshotViewerContent />}
					secondPanel={<MainPanelContent />}
				/>
			</Show>
		</Show>
	);

	const SidebarContent = () => (
		<Show when={showViewerInSidebar()} fallback={<DetailsPanelContent />}>
			<ResizablePanel
				direction="vertical"
				initialFirstPanelSize={SIDEBAR_VIEWER_INITIAL_SIZE_PERCENT}
				minFirstPanelSize={10}
				maxFirstPanelSize={90}
				firstPanel={<ScreenshotViewerContent />}
				secondPanel={<DetailsPanelContent />}
			/>
		</Show>
	);

	return (
		<main
			class="flex flex-col h-full w-full bg-white text-gray-900"
			aria-label="Trace viewer"
		>
			<Show when={props.panels.header}>
				<TraceViewerHeader
					testInfo={props.traceInfo.testInfo}
					errorSpans={errorSpans()}
					hoverTimeMs={displayTimeMs}
					onSpanSelect={handleSpanSelect}
					onSpanHover={handleSearchResultHover}
				/>
			</Show>

			<div class="flex-1 min-h-0 relative">
				<Show when={props.traceData.isLoading()}>
					<LoadingOverlay />
				</Show>

				<Show
					when={showMainColumn() && showDetails()}
					fallback={
						<Show
							when={showMainColumn()}
							fallback={
								<Show when={showDetails()}>
									<SidebarContent />
								</Show>
							}
						>
							<MainColumnContent />
						</Show>
					}
				>
					<ResizablePanel
						direction="horizontal"
						initialFirstPanelSize={75}
						minFirstPanelSize={50}
						maxFirstPanelSize={90}
						firstPanel={<MainColumnContent />}
						secondPanel={<SidebarContent />}
					/>
				</Show>
			</div>
		</main>
	);
}
