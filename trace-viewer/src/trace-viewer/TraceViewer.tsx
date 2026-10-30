import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
	untrack,
} from "solid-js";
import { useTraceDataLoader } from "../trace-data-loader/useTraceDataLoader";
import { isErrorSpan, type Span } from "../trace-data-loader/exportToSpans";
import type { ScreenshotInfo, TraceInfo } from "../trace-info-loader";
import { DetailsPanel } from "./components/DetailsPanel";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { PanelHeader } from "./components/PanelHeader";
import { SpanTimelinePanel } from "./components/SpanTimelinePanel";
import {
	TIMELINE_PANELS,
	type TimelinePanelDefinition,
} from "./components/timelinePanels";
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
import type { NavigationDirection } from "./spanNavigation";
import { TimelineRuler } from "./TimelineRuler";
import { TraceViewerHeader } from "./TraceViewerHeader";
import { layoutTimelineSpans } from "./timelineLayout";
import { useSpanFocus } from "./useSpanFocus";
import {
	isTimeRangeVisible,
	type TimelineViewport,
	timeToViewportPosition,
	viewportPositionToTime,
} from "./viewport";

export interface TraceViewerProps {
	traceInfo: TraceInfo;
}

interface DisabledSection {
	title: string;
	tooltip: string;
}

/** Panel size configuration (without content - content rendered separately) */
interface PanelSizeConfig {
	id: string;
	initialSize: number;
	minSize: number;
}

const SCREENSHOTS_DISABLED_SECTION: DisabledSection = {
	title: "Screenshots",
	tooltip: "No screenshots were captured during this test",
};

const PAN_SENSITIVITY = 0.2;
const ZOOM_SENSITIVITY = 0.005;
const MIN_SELECTION_DISPLAY_PERCENT = 1;
const SCREENSHOT_PANEL_ROW_SIZE_PERCENT = 12;
const TIMELINE_PLOT_INSET_PX = 12;

const ARROW_KEY_DIRECTIONS: Record<string, NavigationDirection> = {
	ArrowLeft: "left",
	ArrowRight: "right",
	ArrowUp: "up",
	ArrowDown: "down",
};

/** Keys typed into inputs and menus belong to those controls, not the timeline. */
function isKeyboardControlTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			target.closest(
				'input, textarea, select, [role="menu"], [role="listbox"], [role="combobox"]',
			) !== null)
	);
}

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
	const {
		viewport,
		displayedViewport,
		motionTransition,
		setViewport,
		zoomToRange,
		pan,
		zoom,
		reset,
	} = useViewportContext();

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
		displayTimeMs,
		displayElements,
		displayFocusedElement,
	} = useHoverContext();

	const [selectionState, setSelectionState] = createSignal<{
		startPosition: number;
		/** The time under the pointer when pressed, mid-animation included */
		startTimeMs: number;
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
	const spanById = createMemo(
		() => new Map(allSpans().map((span) => [span.id, span])),
	);
	// One layout per span panel, read by both rendering and keyboard focus.
	const timelinePanels = TIMELINE_PANELS.map((definition) => ({
		definition,
		layout: createMemo(() =>
			layoutTimelineSpans(definition.spans(props.traceData)),
		),
	}));
	const activeTimelinePanels = createMemo(() =>
		timelinePanels.filter((panel) => panel.layout().bars.length > 0),
	);
	const panelOfSpan = (spanId: string) =>
		timelinePanels.find((panel) => panel.layout().byId.has(spanId));
	const focusedElementFor = (span: Span): FocusedElement => ({
		type: panelOfSpan(span.id)?.definition.elementType ?? "span",
		id: span.id,
	});
	/** With nothing focused, arrow keys start at the root test step. */
	const rootTestSpanId = createMemo(() => {
		const steps = props.traceData.steps();
		const ids = new Set(steps.map((span) => span.id));
		return (
			steps.find(
				(span) =>
					span.name === "playwright.test" &&
					(span.parentId === null || !ids.has(span.parentId)),
			)?.id ?? null
		);
	});
	const errorSpans = createMemo(() =>
		allSpans()
			.filter(isErrorSpan)
			.sort((a, b) => a.startOffsetMs - b.startOffsetMs),
	);

	let plotRef: HTMLDivElement | undefined;
	let detailsRef: HTMLDivElement | undefined;
	const spanFocus = useSpanFocus({
		panels: () =>
			timelinePanels.map((panel) => ({
				elementType: panel.definition.elementType,
				layout: panel.layout(),
			})),
		startSpanId: () =>
			rootTestSpanId() ??
			activeTimelinePanels()[0]?.layout().rows[0]?.[0]?.id ??
			null,
		plotWidthPx: () => plotRef?.getBoundingClientRect().width ?? 0,
	});
	// Live pointer state, tracked independently of locked/search display state.
	let pointerElement: FocusedElement | null = null;
	let pointerPosition: number | null = null;
	const setPointerElement = (element: FocusedElement | null) => {
		pointerElement = element;
		if (mode() === "hover") setHoveredElement(element);
	};
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
	// Get list of disabled sections for the footer
	const disabledSections = createMemo((): DisabledSection[] => {
		const sections: DisabledSection[] = [];
		if (!props.traceInfo.screenshots.loading && !hasLoadedScreenshots()) {
			sections.push(SCREENSHOTS_DISABLED_SECTION);
		}
		for (const panel of timelinePanels) {
			if (panel.layout().bars.length === 0) {
				sections.push({
					title: panel.definition.title,
					tooltip: panel.definition.emptyTooltip,
				});
			}
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
		const active = activeTimelinePanels().map((panel) => panel.definition.id);
		const sizes = calculateInitialPanelSizes({
			steps: active.includes("steps"),
			browser: active.includes("browser"),
			external: active.includes("external"),
		});
		return active.map((id) => ({
			id,
			initialSize: sizes[id] ?? 0,
			minSize: 15,
		}));
	});

	// Check if we have any active span panels
	const hasAnySpanPanels = () => spanPanelSizeConfigs().length > 0;

	const handleMouseDown = (e: MouseEvent) => {
		// Only start selection on primary button
		if (e.button !== 0) return;
		if (!plotRef) return;

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
				startTimeMs: viewportPositionToTime(position, displayedViewport()),
				currentPosition: position,
				element: pointerElement,
			});
		}
	};

	const handleMouseMove = (e: MouseEvent) => {
		if (!plotRef) return;

		const rect = plotRef.getBoundingClientRect();
		const position = (e.clientX - rect.left) / rect.width;

		// Update selection if dragging
		const selection = selectionState();
		if (selection) {
			const clampedPosition = Math.max(0, Math.min(1, position));
			setSelectionState({
				...selection,
				currentPosition: clampedPosition,
			});
		}

		// Resize handles (cursor-*-resize) have no time position
		const computedStyle = window.getComputedStyle(e.target as HTMLElement);
		const isOnResizeHandle =
			computedStyle.cursor === "col-resize" ||
			computedStyle.cursor === "row-resize";
		pointerPosition =
			!isOnResizeHandle && position >= 0 && position <= 1 ? position : null;

		// Only update hover position in hover mode
		if (mode() === "hover") {
			setHoverPosition(pointerPosition);
		}
	};

	const handleMouseUp = () => {
		const selection = selectionState();
		if (selection) {
			// Positions are on screen, which differs from the target mid-animation.
			const shown = displayedViewport();
			const startMs = viewportPositionToTime(
				Math.min(selection.startPosition, selection.currentPosition),
				shown,
			);
			const endMs = viewportPositionToTime(
				Math.max(selection.startPosition, selection.currentPosition),
				shown,
			);

			// Only zoom if selection is meaningful (not just a click)
			// Minimum 2% of current visible duration
			const visibleDuration = shown.visibleEndMs - shown.visibleStartMs;
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
						lock(selection.startTimeMs, selection.element);
						break;
					case "locked":
					case "search-override":
						// Any click unlocks - set hover position to click location
						// so the hover line appears immediately
						setHoverPosition(selection.startPosition);
						unlock();
						setHoveredElement(pointerElement);
						break;
				}
			}

			setSelectionState(null);
		}
	};

	const handleMouseLeave = () => {
		pointerPosition = null;
		setPointerElement(null);
		if (mode() === "hover") {
			setHoverPosition(null);
		}
		// Don't clear selection on mouse leave - user might drag outside temporarily
	};

	let arrowKeysScrollDetails = false;

	// Set up global mouseup listener to handle drag end outside component
	onMount(() => {
		const onGlobalMouseUp = () => handleMouseUp();
		document.addEventListener("mouseup", onGlobalMouseUp);

		const onKeyDown = (e: KeyboardEvent) => {
			const currentMode = mode();
			if (e.key === "Escape" && currentMode !== "hover") {
				unlock();
				setHoverPosition(pointerPosition);
				setHoveredElement(pointerElement);
				return;
			}

			const direction = ARROW_KEY_DIRECTIONS[e.key];
			if (
				!direction ||
				e.defaultPrevented ||
				e.altKey ||
				e.ctrlKey ||
				e.metaKey ||
				e.shiftKey ||
				arrowKeysScrollDetails ||
				isKeyboardControlTarget(e.target)
			) {
				return;
			}
			e.preventDefault();
			spanFocus.navigate(direction);
		};
		document.addEventListener("keydown", onKeyDown);

		// After pressing inside the details panel, arrow keys scroll it, as the
		// browser would; pressing anywhere else gives them back to the timeline.
		const onPointerDown = (e: PointerEvent) => {
			arrowKeysScrollDetails =
				e.target instanceof Node && !!detailsRef?.contains(e.target);
		};
		document.addEventListener("pointerdown", onPointerDown, true);

		onCleanup(() => {
			document.removeEventListener("mouseup", onGlobalMouseUp);
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("pointerdown", onPointerDown, true);
		});
	});

	const handleViewportChange = (newViewport: TimelineViewport) => {
		setViewport(newViewport);
	};

	const handleWheel = (e: WheelEvent) => {
		if (!plotRef) return;

		// Check for zoom modifier keys (Cmd, Ctrl, or Shift)
		const isZoomModifier = e.metaKey || e.ctrlKey || e.shiftKey;

		if (isZoomModifier && e.deltaY !== 0) {
			e.preventDefault();

			const rect = plotRef.getBoundingClientRect();
			const pointerPosition = Math.max(
				0,
				Math.min(1, (e.clientX - rect.left) / rect.width),
			);
			const lockTimeMs = mode() === "hover" ? null : lockedTimeMs();
			const lockPosition =
				lockTimeMs === null
					? null
					: timeToViewportPosition(lockTimeMs, displayedViewport());
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
		setPointerElement(id ? { type: "screenshot", id } : null);
	};

	const handleBarHover = (
		definition: TimelinePanelDefinition,
		id: string | null,
	) => {
		setPointerElement(id ? { type: definition.elementType, id } : null);
	};

	/** Search results and error spans select a span like any other focus. */
	const handleSpanSelect = spanFocus.focusSpan;

	/** The details panel's span links focus a span and hand arrow keys back. */
	const handleNavigateToSpan = (spanId: string) => {
		arrowKeysScrollDetails = false;
		spanFocus.focusSpan(spanId);
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
		const span = spanById().get(spanId);

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
			setHoveredElement(focusedElementFor(span));
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

		const renderPanelContent = (panelId: string) => {
			const panel = timelinePanels.find(
				(candidate) => candidate.definition.id === panelId,
			);
			if (!panel) return null;
			const { definition } = panel;
			return (
				<SpanTimelinePanel
					definition={definition}
					layout={panel.layout()}
					focusedSpanId={spanFocus.focusedSpanId()}
					revealRequest={spanFocus.revealRequest()}
					onBarHover={(id) => handleBarHover(definition, id)}
					matchedSpanIds={search.matchedSpanIds()}
					hoveredSearchSpanId={hoveredSearchSpanId()}
				/>
			);
		};

		// Rebuild the panels whenever a section gains or loses its last span,
		// which happens as a live trace streams in. Keyed on the IDs alone so
		// new spans in an existing section keep its size.
		const activePanelIds = createMemo(() =>
			spanPanelSizeConfigs()
				.map((config) => config.id)
				.join(","),
		);

		return (
			<Show when={activePanelIds()} keyed>
				{(_panelIds) => {
					const configs = untrack(spanPanelSizeConfigs).map((config) => ({
						...config,
						content: renderPanelContent(config.id),
					}));

					if (configs.length === 1) {
						return (
							<div class="h-full min-h-0 overflow-hidden">
								{configs[0].content}
							</div>
						);
					}

					return <MultiResizablePanel direction="vertical" panels={configs} />;
				}}
			</Show>
		);
	};

	const MainPanelContent = () => (
		// One plot box defines ruler, pointer, screenshots and span coordinates.
		// Panels stay full width; only their plotted content is inset. Reserve the
		// native scrollbar width in every plot, even in unscrolled panels.
		<div
			class="flex flex-col h-full relative"
			style={{
				"container-type": "inline-size",
				"--timeline-plot-inset": `${TIMELINE_PLOT_INSET_PX}px`,
				"--timeline-plot-width": `calc(100cqw - ${2 * TIMELINE_PLOT_INSET_PX + scrollbarWidth()}px)`,
			}}
		>
			<Show when={props.traceData.isLoading()}>
				<LoadingOverlay />
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
					class="absolute inset-y-0 pointer-events-none"
					style={{
						left: "var(--timeline-plot-inset)",
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
							style={{
								left: `${hoverPosition()! * 100}%`,
								transition: motionTransition("left"),
							}}
						/>
					</Show>

					{/* Position indicator - locked mode: thick blue line */}
					<Show when={mode() === "locked" && lockedPosition() !== null}>
						<div
							data-locked-time-line
							class="absolute top-0 bottom-0 bg-blue-600 pointer-events-none z-50"
							style={{
								left: `${lockedPosition()! * 100}%`,
								width: "3px",
								"margin-left": "-1px",
								transition: motionTransition("left"),
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
									transition: motionTransition("left"),
								}}
							/>
						</Show>
						{/* Search hover position - thin lighter blue line */}
						<Show when={hoverPosition() !== null}>
							<div
								class="absolute top-0 bottom-0 w-px bg-blue-400 pointer-events-none z-45"
								style={{
									left: `${hoverPosition()! * 100}%`,
									transition: motionTransition("left"),
								}}
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
						<div ref={detailsRef} class="h-full min-h-0">
							<DetailsPanel
								traceInfo={props.traceInfo}
								hoveredElements={displayElements()}
								testStartTimeMs={props.testStartTimeMs()}
								focusedElement={displayFocusedElement()}
								onNavigateToSpan={handleNavigateToSpan}
							/>
						</div>
					}
				/>
			</div>
		</main>
	);
}
