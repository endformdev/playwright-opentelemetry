import {
	batch,
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onMount,
	Show,
	untrack,
} from "solid-js";
import { useTraceDataLoader } from "../trace-data-loader/useTraceDataLoader";
import { isErrorSpan, type Span } from "../trace-data-loader/exportToSpans";
import type { TraceInfo } from "../trace-info-loader";
import { DetailsPanel } from "./components/DetailsPanel";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { SpanTimelinePanel } from "./components/SpanTimelinePanel";
import { TIMELINE_PANELS } from "./components/timelinePanels";
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
import { MultiResizablePanel } from "./MultiResizablePanel";
import {
	calculateInitialPanelSizes,
	getPlayerFilmstripSizePercent,
	MIN_PLAYER_SIZE_PERCENT,
	PLAYER_BIG_SCREEN_SIZE_PERCENT,
} from "./panelSizing";
import { ResizablePanel } from "./ResizablePanel";
import type { NavigationDirection } from "./spanNavigation";
import type { SpanSelectionPlacement } from "./spanSelection";
import { ScreenshotFilmstrip } from "./ScreenshotFilmstrip";
import { describeStepRulerTime } from "./stepRulerSegments";
import { StepViewer } from "./StepViewer";
import { TimelineRuler } from "./TimelineRuler";
import { TraceViewerHeader } from "./TraceViewerHeader";
import { buildTestStructure, getStepAncestry } from "./testStructure";
import { layoutTimelineSpans } from "./timelineLayout";
import { usePlayback } from "./usePlayback";
import { useSpanFocus } from "./useSpanFocus";
import { useStepViewer } from "./useStepViewer";
import { useTimelinePointer } from "./useTimelinePointer";
import type { ViewerAction } from "./viewerAction";
import type { ViewerHighlight } from "./viewerHighlight";
import { type ViewerPanels, viewerSettingsFromPanels } from "./viewerPanels";
import { createViewerSettings, type ViewerSectionKey } from "./viewerSettings";
import {
	isTimeRangeVisible,
	panTimeRangeIntoView,
	timeToViewportPosition,
	viewportPositionToTime,
} from "./viewport";

export interface TraceViewerProps {
	traceInfo: TraceInfo;
	/**
	 * Which regions to show, e.g. from the URL. Replaces the saved viewer
	 * settings for this page load. When absent, the saved settings apply and
	 * the header, ruler and details sidebar are shown.
	 */
	panels?: ViewerPanels | null;
	/** Adds a button for this action to the player's control bar */
	action?: ViewerAction | null;
	/** A span to open on and mark on the step ruler, e.g. from the URL */
	highlight?: ViewerHighlight | null;
}

/** Panel size configuration (without content - content rendered separately) */
interface PanelSizeConfig {
	id: string;
	initialSize: number;
	minSize: number;
}

const NO_SCREENSHOTS_TOOLTIP = "No screenshots were captured during this test";

const PAN_SENSITIVITY = 0.2;
const ZOOM_SENSITIVITY = 0.005;
const MIN_SELECTION_DISPLAY_PERCENT = 1;
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
						panels={props.panels ?? null}
						action={props.action ?? null}
						highlight={props.highlight ?? null}
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
	panels: ViewerPanels | null;
	action: ViewerAction | null;
	highlight: ViewerHighlight | null;
}

function TraceViewerInner(props: TraceViewerInnerProps) {
	const {
		viewport,
		displayedViewport,
		motionTransition,
		setViewport,
		animateTo,
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
	const { settings, setSetting } = createViewerSettings(
		props.panels ? viewerSettingsFromPanels(props.panels) : undefined,
	);
	// Regions the settings menu doesn't cover are only chosen by `panels`.
	const showHeader = () => props.panels?.header ?? true;
	const showRuler = () => props.panels?.ruler ?? true;
	const showDetails = () => props.panels?.details ?? true;
	const shownTimelinePanels = createMemo(() =>
		activeTimelinePanels().filter((panel) => settings()[panel.definition.id]),
	);
	const panelOfSpan = (spanId: string) =>
		timelinePanels.find((panel) => panel.layout().byId.has(spanId));
	const focusedElementFor = (span: Span): FocusedElement => ({
		type: panelOfSpan(span.id)?.definition.elementType ?? "span",
		id: span.id,
	});
	const testStructure = createMemo(() =>
		buildTestStructure(props.traceData.steps()),
	);
	/** With nothing focused, arrow keys start at the root test step. */
	const rootTestSpanId = () => testStructure().root?.id ?? null;
	const errorSpans = createMemo(() =>
		allSpans()
			.filter(isErrorSpan)
			.sort((a, b) => a.startOffsetMs - b.startOffsetMs),
	);

	let plotRef: HTMLDivElement | undefined;
	let detailsRef: HTMLDivElement | undefined;
	/** The span panels' region, below the player, where zoomed frames open */
	let spansRegionRef: HTMLDivElement | undefined;
	const spanFocus = useSpanFocus({
		panels: () =>
			shownTimelinePanels().map((panel) => ({
				elementType: panel.definition.elementType,
				layout: panel.layout(),
			})),
		startSpanId: () =>
			(settings().steps ? rootTestSpanId() : null) ??
			shownTimelinePanels()[0]?.layout().rows[0]?.[0]?.id ??
			null,
		plotWidthPx: () => plotRef?.getBoundingClientRect().width ?? 0,
	});
	const pointer = useTimelinePointer({ plot: () => plotRef });
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
	const showStepViewer = () => settings().stepViewer && hasScreenshots();
	/** The step viewer shows a filmstrip rather than the big screen */
	const showPlayerFilmstrip = () =>
		showStepViewer() && settings().playerScreen === "filmstrip";
	const [columnHeightPx, setColumnHeightPx] = createSignal(0);
	const columnObserver = new ResizeObserver(([entry]) => {
		if (entry) setColumnHeightPx(entry.contentRect.height);
	});
	onCleanup(() => columnObserver.disconnect());
	/** The big screen wants the room; the filmstrip only needs its rows. */
	const playerSizePercent = () =>
		settings().playerScreen === "filmstrip"
			? getPlayerFilmstripSizePercent(
					stepViewer.pages().length,
					columnHeightPx(),
				)
			: PLAYER_BIG_SCREEN_SIZE_PERCENT;
	// Sections with nothing to show are disabled in the settings menu.
	const emptySections = createMemo(() => {
		const sections: Partial<Record<ViewerSectionKey, string>> = {};
		if (!hasScreenshots()) sections.stepViewer = NO_SCREENSHOTS_TOOLTIP;
		for (const panel of timelinePanels) {
			if (panel.layout().bars.length === 0) {
				sections[panel.definition.id] = panel.definition.emptyTooltip;
			}
		}
		return sections;
	});

	// Calculate initial sizes for span panels (just the sizing data, not content)
	const spanPanelSizeConfigs = createMemo((): PanelSizeConfig[] => {
		const active = shownTimelinePanels().map((panel) => panel.definition.id);
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
	const showMainColumn = () =>
		showStepViewer() || showRuler() || hasAnySpanPanels();

	let arrowKeysScrollDetails = false;

	onMount(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && mode() !== "hover") {
				pointer.unlockToPointer();
				return;
			}

			if (
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

			if (playback.handleKeyDown(e)) return;
			if (stepViewer.handleKeyDown(e)) return;

			const direction = ARROW_KEY_DIRECTIONS[e.key];
			if (!direction) return;
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
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("pointerdown", onPointerDown, true);
		});
	});

	const stepViewer = useStepViewer({
		structure: testStructure,
		screenshots: () => props.traceInfo.screenshots() ?? [],
		testStartTimeMs: props.testStartTimeMs,
		peekTimeMs: pointer.peekTimeMs,
		loaded: () =>
			props.traceData.status() === "loaded" &&
			!props.traceInfo.screenshots.loading,
		enabled: showStepViewer,
		canFrame: () => settings().steps,
		spanFocus,
	});

	const playback = usePlayback({
		endMs: () => props.traceData.totalDurationMs(),
		enabled: () => showStepViewer() && !props.traceData.isLoading(),
	});

	/** Time hovered in the span panels, which the ruler marks too */
	const spanHoverTimeMs = () => {
		const position = hoverPosition();
		if (mode() === "locked" || position === null) return null;
		return viewportPositionToTime(position, viewport());
	};

	/** The shown step (the stop, or the step playing) and its ancestors */
	const stepViewerStepAncestry = createMemo(() => {
		const index = stepViewer.shownIndex();
		const stop = index === null ? null : stepViewer.stops()[index];
		return stop ? getStepAncestry(stop.stepId, spanById()) : [];
	});

	// The focus ring marks span navigation. On a step viewer stop the subject
	// is a moment, shown by the time line and the viewer's caption instead.
	const timelineFocusedSpanId = () =>
		stepViewer.currentIndex() === null ? spanFocus.focusedSpanId() : null;

	/** Wheel zooms and pans the timeline; `plot` is the plot box under it. */
	const handleWheel = (
		e: WheelEvent,
		plot: DOMRect | undefined = plotRef?.getBoundingClientRect(),
	) => {
		if (!plot) return;

		// Check for zoom modifier keys (Cmd, Ctrl, or Shift)
		const isZoomModifier = e.metaKey || e.ctrlKey || e.shiftKey;

		if (isZoomModifier && e.deltaY !== 0) {
			e.preventDefault();

			const pointerPosition = Math.max(
				0,
				Math.min(1, (e.clientX - plot.left) / plot.width),
			);
			const lockTimeMs = lockedTimeMs();
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

	/** Seeking on the step ruler locks there, keeping the time in view. */
	const handleRulerSeek = (timeMs: number) => {
		batch(() => {
			lock(timeMs, null, "ruler");
			animateTo(panTimeRangeIntoView(viewport(), timeMs, timeMs, timeMs));
		});
	};

	/** The highlighted span, when the trace contains it */
	const highlightedSpan = createMemo(() => {
		const spanId = props.highlight?.spanId;
		return spanId ? (spanById().get(spanId) ?? null) : null;
	});
	const rulerMarkers = createMemo(() => {
		const span = highlightedSpan();
		return span && props.highlight
			? [{ timeMs: span.startOffsetMs, label: props.highlight.label }]
			: [];
	});

	// Once loaded, open on the highlighted span. Locking first keeps the step
	// viewer from opening on the first screenshot instead.
	let openedOnHighlight = false;
	createEffect(() => {
		if (openedOnHighlight || props.traceData.status() !== "loaded") return;
		openedOnHighlight = true;
		const span = highlightedSpan();
		if (span) untrack(() => handleRulerSeek(span.startOffsetMs));
	});

	/**
	 * Search results and error spans take over the selection and go to the
	 * span: zoomed to fit and with its row centred.
	 */
	const handleSpanSelect = (
		spanId: string,
		placement: SpanSelectionPlacement,
	) => {
		spanFocus.focusSpan(spanId, { at: placement, view: "fit" });
	};

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
					focusedSpanId={timelineFocusedSpanId()}
					revealRequest={spanFocus.revealRequest()}
					onBarHover={(id) =>
						pointer.hoverElement(
							id ? { type: definition.elementType, id } : null,
						)
					}
					matchedSpanIds={search.matchedSpanIds()}
					hoveredSearchSpanId={hoveredSearchSpanId()}
				/>
			);
		};

		// Rebuild the panels, with fresh initial sizes, whenever settings change
		// which of them are shown.
		const shownPanelKey = createMemo(() =>
			spanPanelSizeConfigs()
				.map((config) => config.id)
				.join("|"),
		);

		return (
			<Show when={shownPanelKey()} keyed>
				{(_key) => {
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

	/**
	 * Whether a hovered position is on the plot. The ruler hovers the whole
	 * test, out of view when zoomed. Locked lines are still drawn off the
	 * plot, so they can slide into view with the bars.
	 */
	const isInPlot = (position: number | null) =>
		position !== null && position >= 0 && position <= 1;

	// The step ruler: at the bottom of the player, right on top of the steps
	// timeline, or without the player at the top of the span panels.
	const Ruler = () => (
		<TimelineRuler
			durationMs={props.traceData.totalDurationMs()}
			viewport={viewport()}
			onViewportChange={setViewport}
			onDoubleClick={handleDoubleClick}
			segments={stepViewer.segments()}
			playheadMs={lockedTimeMs()}
			currentStopIndex={stepViewer.shownIndex()}
			hoverTimeMs={spanHoverTimeMs()}
			onSeek={handleRulerSeek}
			onPointerTime={(timeMs, stepId) =>
				pointer.hoverTime(timeMs, stepId ? { type: "step", id: stepId } : null)
			}
			screenshots={props.traceInfo.screenshots() ?? []}
			testStartTimeMs={props.testStartTimeMs()}
			showFilmstrip={!showPlayerFilmstrip()}
			filmstripPlacement={showStepViewer() ? "above" : "below"}
			markers={rulerMarkers()}
		/>
	);

	/** The span panels, sharing the plot box and the time lines */
	const SpansRegion = () => (
		<div
			class="flex-1 min-h-0 relative flex flex-col"
			role="region"
			aria-label="Trace timeline"
			style={{ cursor: pointer.selection() ? "crosshair" : undefined }}
			onMouseDown={pointer.handleMouseDown}
			onMouseMove={pointer.handleMouseMove}
			onMouseLeave={pointer.handleMouseLeave}
			onWheel={(event) => handleWheel(event)}
			onDblClick={handleDoubleClick}
			ref={spansRegionRef}
		>
			<div class="flex-1 min-h-0 overflow-hidden">
				<SpanPanelsContent />
			</div>

			<div
				ref={plotRef}
				data-timeline-plot
				class="absolute inset-y-0 pointer-events-none"
				style={{
					left: "var(--timeline-plot-inset)",
					width: "var(--timeline-plot-width)",
				}}
			>
				{/* The range being dragged, once it is more than a click */}
				<Show
					when={
						(pointer.selection()?.widthPercent ?? 0) >
						MIN_SELECTION_DISPLAY_PERCENT
					}
				>
					<div
						class="absolute top-0 bottom-0 bg-gray-900/10 border-x border-gray-500 pointer-events-none z-40"
						style={{
							left: `${pointer.selection()?.leftPercent}%`,
							width: `${pointer.selection()?.widthPercent}%`,
						}}
					/>
				</Show>

				{/* The hovered time, or a search result's while locked: a thin line */}
				<Show when={mode() !== "locked" && isInPlot(hoverPosition())}>
					<div
						class="absolute top-0 bottom-0 w-px pointer-events-none z-50"
						classList={{
							"bg-gray-900": mode() === "hover",
							"bg-gray-500": mode() === "search-override",
						}}
						style={{
							left: `${hoverPosition()! * 100}%`,
							transition: motionTransition("left"),
						}}
					/>
				</Show>

				{/* The locked time: a thick line */}
				<Show when={lockedPosition() !== null}>
					<div
						data-locked-time-line
						data-time-ms={lockedTimeMs()}
						class="absolute top-0 bottom-0 bg-fill-playhead pointer-events-none z-50"
						style={{
							left: `${lockedPosition()! * 100}%`,
							width: "3px",
							"margin-left": "-1px",
							transition: motionTransition("left"),
						}}
					/>
				</Show>
			</div>
		</div>
	);

	const SpansColumn = () => (
		<div class="flex flex-col h-full">
			<Show when={!showStepViewer() && showRuler()}>
				<Ruler />
			</Show>
			<Show when={hasAnySpanPanels()}>
				<SpansRegion />
			</Show>
		</div>
	);

	const StepViewerContent = () => (
		<StepViewer
			ref={stepViewer.ref}
			screenshot={stepViewer.screenshot()}
			screenshotsLoading={
				props.traceInfo.screenshots.loading || stepViewer.screenshotPending()
			}
			stopCount={stepViewer.stops().length}
			stopIndex={stepViewer.shownIndex()}
			stepAncestry={stepViewerStepAncestry()}
			// In the filmstrip, every page has a row; there is no page to pick.
			pages={showPlayerFilmstrip() ? [] : stepViewer.pages()}
			pinnedPageId={stepViewer.pinnedPageId()}
			onPinPage={stepViewer.pinPage}
			onActivate={stepViewer.activate}
			onNavigate={stepViewer.navigate}
			playing={playback.playing()}
			playbackSpeed={playback.speed()}
			onTogglePlayback={playback.toggle}
			onCycleSpeed={playback.cycleSpeed}
			action={props.action}
			ruler={
				<Show when={showRuler()}>
					<Ruler />
				</Show>
			}
			filmstrip={
				showPlayerFilmstrip() ? (
					<ScreenshotFilmstrip
						screenshots={props.traceInfo.screenshots() ?? []}
						screenshotsLoading={props.traceInfo.screenshots.loading}
						viewport={viewport()}
						testStartTimeMs={props.testStartTimeMs()}
						lockedTimeMs={lockedTimeMs()}
						hoverTimeMs={spanHoverTimeMs()}
						describeTime={(timeMs) =>
							describeStepRulerTime(stepViewer.segments(), timeMs)
						}
						zoomArea={() => spansRegionRef?.getBoundingClientRect() ?? null}
						onPointerTime={(timeMs) => pointer.hoverTime(timeMs, null)}
						onSeek={handleRulerSeek}
						onWheel={handleWheel}
					/>
				) : undefined
			}
		/>
	);

	const DetailsContent = () => (
		<div ref={detailsRef} class="h-full min-h-0">
			<DetailsPanel
				traceInfo={props.traceInfo}
				hoveredElements={displayElements()}
				testStartTimeMs={props.testStartTimeMs()}
				focusedElement={displayFocusedElement()}
				onNavigateToSpan={handleNavigateToSpan}
			/>
		</div>
	);

	// The player stacks above the span panels, resizable against them; either
	// can be left out. One plot box, shared by the step ruler and the span
	// panels, lines up their times. Panels stay full width; only their
	// plotted content is inset, reserving the native scrollbar width in every
	// plot, even in unscrolled panels.
	const MainColumnContent = () => (
		<div
			ref={(element) => columnObserver.observe(element)}
			class="relative flex flex-col h-full"
			style={{
				"container-type": "inline-size",
				"--timeline-plot-inset": `${TIMELINE_PLOT_INSET_PX}px`,
				"--timeline-plot-width": `calc(100cqw - ${2 * TIMELINE_PLOT_INSET_PX + scrollbarWidth()}px)`,
			}}
		>
			<Show when={props.traceData.isLoading()}>
				<LoadingOverlay />
			</Show>
			<Show when={showStepViewer()} fallback={<SpansColumn />}>
				<Show when={hasAnySpanPanels()} fallback={<StepViewerContent />}>
					<ResizablePanel
						direction="vertical"
						initialFirstPanelSize={playerSizePercent()}
						sizeKey={settings().playerScreen}
						minFirstPanelSize={MIN_PLAYER_SIZE_PERCENT}
						maxFirstPanelSize={85}
						firstPanel={<StepViewerContent />}
						secondPanel={<SpansColumn />}
					/>
				</Show>
			</Show>
		</div>
	);

	return (
		<main
			class="flex flex-col h-full w-full bg-white text-gray-900"
			aria-label="Trace viewer"
		>
			<Show when={showHeader()}>
				<TraceViewerHeader
					testInfo={props.traceInfo.testInfo}
					errorSpans={errorSpans()}
					hoverTimeMs={displayTimeMs}
					onSpanSelect={handleSpanSelect}
					onSpanHover={handleSearchResultHover}
					settings={settings()}
					onSettingChange={setSetting}
					emptySections={emptySections()}
				/>
			</Show>

			<div class="flex-1 min-h-0">
				<Show
					when={showMainColumn() && showDetails()}
					fallback={
						<Show
							when={showMainColumn()}
							fallback={
								<Show when={showDetails()}>
									<DetailsContent />
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
						secondPanel={<DetailsContent />}
					/>
				</Show>
			</div>
		</main>
	);
}
