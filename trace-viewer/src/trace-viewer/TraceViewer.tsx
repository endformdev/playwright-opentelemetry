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
import { StepsTimeline } from "./components/StepsTimeline";
import {
	type FocusedElement,
	HoverProvider,
	useHoverContext,
} from "./contexts/HoverContext";
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
import {
	isTimeRangeVisible,
	type TimelineViewport,
	timeToViewportPosition,
	viewportPositionToTime,
} from "./viewport";

export interface TraceViewerProps {
	traceInfo: TraceInfo;
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
		setHoveredElement,
		lockedElement,
		displayTimeMs,
		displayElements,
		displayFocusedElement,
	} = useHoverContext();

	const [selectionState, setSelectionState] = createSignal<{
		startPosition: number;
		currentPosition: number;
		element: FocusedElement | null;
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
	let plotRef: HTMLDivElement | undefined;
	let pointerElement: FocusedElement | null = null;
	let pointerPosition: number | null = null;
	const [scrollbarWidth, setScrollbarWidth] = createSignal(0);
	onMount(() => {
		const probe = document.createElement("div");
		probe.style.cssText =
			"position:absolute;visibility:hidden;width:100px;height:100px;overflow:scroll";
		document.body.append(probe);
		setScrollbarWidth(probe.offsetWidth - probe.clientWidth);
		probe.remove();
	});
	// Determine which sections are active/disabled
	const hasLoadedScreenshots = () =>
		(props.traceInfo.screenshots() ?? []).length > 0;
	const hasScreenshots = () =>
		props.traceInfo.screenshots.loading || hasLoadedScreenshots();
	const screenshotPageCount = createMemo(() =>
		countScreenshotPages(props.traceInfo.screenshots() ?? []),
	);
	const screenshotPanelInitialSize = createMemo(
		() =>
			SCREENSHOT_PANEL_ROW_SIZE_PERCENT *
			getDefaultVisibleScreenshotRows(screenshotPageCount()),
	);
	const hasSteps = () => props.traceData.steps().length > 0;
	const hasBrowserSpans = () => props.traceData.browserSpans().length > 0;
	const hasExternalSpans = () => props.traceData.externalSpans().length > 0;

	// Get list of disabled sections for the footer
	const disabledSections = createMemo((): DisabledSection[] => {
		const sections: DisabledSection[] = [];
		if (!props.traceInfo.screenshots.loading && !hasLoadedScreenshots()) {
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

	const handleMouseDown = (e: MouseEvent) => {
		// Only start selection on primary button
		if (e.button !== 0) return;
		if (!contentAreaRef || !plotRef) return;

		// Don't start selection if clicking on resize handles
		const target = e.target as HTMLElement;
		const computedStyle = window.getComputedStyle(target);
		if (
			computedStyle.cursor === "col-resize" ||
			computedStyle.cursor === "row-resize"
		) {
			return;
		}

		const rect = plotRef.getBoundingClientRect();
		const position = (e.clientX - rect.left) / rect.width;

		if (position >= 0 && position <= 1) {
			setSelectionState({
				startPosition: position,
				currentPosition: position,
				element:
					elementAtTarget(e.target) ??
					(e.target instanceof Element &&
					e.target.closest('[aria-label="Screenshots"]')
						? pointerElement
						: null),
			});
		}
	};

	// Resolve the current DOM hit, including text and event-marker descendants.
	const elementAtTarget = (
		target: EventTarget | null,
	): FocusedElement | null => {
		if (!(target instanceof Element)) return null;
		const bar = target.closest<HTMLElement>("[data-span-id]");
		if (bar && contentAreaRef?.contains(bar)) {
			const id = bar.dataset.spanId!;
			return {
				type: props.traceData.steps().some((step) => step.id === id)
					? "step"
					: "span",
				id,
			};
		}
		return null;
	};

	const handleMouseMove = (e: MouseEvent) => {
		if (!contentAreaRef || !plotRef) return;

		const rect = plotRef.getBoundingClientRect();
		const position = (e.clientX - rect.left) / rect.width;
		pointerPosition = position >= 0 && position <= 1 ? position : null;

		// Update selection if dragging
		const selection = selectionState();
		if (selection) {
			const clampedPosition = Math.max(0, Math.min(1, position));
			setSelectionState({
				...selection,
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

		// Track the live hit independently of locked/search display state.
		if (
			!(e.target instanceof Element) ||
			!e.target.closest('[aria-label="Screenshots"]')
		) {
			pointerElement = elementAtTarget(e.target);
		}
		if (mode() === "hover") {
			setHoveredElement(pointerElement);
			if (position >= 0 && position <= 1) {
				setHoverPosition(position);
			} else {
				setHoverPosition(null);
			}
		}
	};

	const handleMouseUp = (event: MouseEvent) => {
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
							selection.element,
						);
						break;
					case "locked":
					case "search-override":
						// Any click unlocks - set hover position to click location
						// so the hover line appears immediately
						setHoverPosition(selection.startPosition);
						unlock();
						setHoveredElement(
							elementAtTarget(event.target) ??
								(event.target instanceof Element &&
								event.target.closest('[aria-label="Screenshots"]')
									? pointerElement
									: null),
						);
						break;
				}
			}

			setSelectionState(null);
		}
	};

	const handleMouseLeave = () => {
		pointerElement = null;
		pointerPosition = null;
		if (mode() === "hover") {
			setHoverPosition(null);
			setHoveredElement(null);
		}
		// Don't clear selection on mouse leave - user might drag outside temporarily
	};

	// Set up global mouseup listener to handle drag end outside component
	onMount(() => {
		const onGlobalMouseUp = (event: MouseEvent) => handleMouseUp(event);
		document.addEventListener("mouseup", onGlobalMouseUp);

		const onKeyDown = (e: KeyboardEvent) => {
			const currentMode = mode();
			if (e.key === "Escape" && currentMode !== "hover") {
				unlock();
				setHoverPosition(pointerPosition);
				setHoveredElement(pointerElement);
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
		if (!contentAreaRef || !plotRef) return;

		// Check for zoom modifier keys (Cmd, Ctrl, or Shift)
		const isZoomModifier = e.metaKey || e.ctrlKey || e.shiftKey;

		if (isZoomModifier && e.deltaY !== 0) {
			e.preventDefault();

			const rect = plotRef.getBoundingClientRect();
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

	const handleScreenshotHover = (id: string | null) => {
		pointerElement = id ? { type: "screenshot", id } : null;
		if (mode() === "hover") setHoveredElement(pointerElement);
	};

	const handleStepHover = (id: string | null) => {
		if (mode() === "hover") setHoveredElement(id ? { type: "step", id } : null);
	};

	const handleSpanHover = (id: string | null) => {
		if (mode() === "hover") setHoveredElement(id ? { type: "span", id } : null);
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
		// One content box defines ruler, pointer, screenshots and span coordinates.
		// Reserve the native scrollbar width in every plot, even in unscrolled panels.
		<div
			class="flex flex-col h-full relative px-4"
			style={{
				"container-type": "inline-size",
				"--timeline-plot-width": `calc(100cqw - ${scrollbarWidth()}px)`,
			}}
		>
			<Show when={props.traceData.isLoading()}>
				<LoadingOverlay />
			</Show>

			<div style={{ width: "var(--timeline-plot-width)" }}>
				<TimelineRuler
					durationMs={props.traceData.totalDurationMs()}
					viewport={viewport()}
					hoverPosition={hoverPosition()}
					onViewportChange={handleViewportChange}
					testPhases={testPhases()}
					onPhaseClick={handlePhaseClick}
					onDoubleClick={handleDoubleClick}
				/>
			</div>

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

				<div
					ref={plotRef}
					data-timeline-plot
					class="absolute inset-y-0 left-0 pointer-events-none"
					style={{
						width: "var(--timeline-plot-width)",
					}}
				>
					{/* Selection overlay - only show when selection is meaningful */}
					<Show
						when={
							selectionState() &&
							selectionWidth() > MIN_SELECTION_DISPLAY_PERCENT
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
		</div>
	);

	return (
		<main
			class="flex flex-col h-full w-full bg-white text-gray-900"
			aria-label="Trace viewer"
		>
			<TraceViewerHeader
				testInfo={props.traceInfo.testInfo}
				errorSpans={errorSpans()}
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
							onNavigateToSpan={handleSpanNavigate}
						/>
					}
				/>
			</div>
		</main>
	);
}
