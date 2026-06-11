import {
	createEffect,
	createMemo,
	createSignal,
	For,
	on,
	onCleanup,
	Show,
} from "solid-js";
import type { SpanKind } from "../../trace-data-loader/exportToSpans";
import type { TraceInfo } from "../../trace-info-loader";
import type { FocusedElement } from "../contexts/HoverContext";
import {
	flattenHoveredSpans,
	type HoveredElements,
} from "../getElementsAtTime";
import {
	getResourceColor,
	getResourceDisplayName,
	getResourceIcon,
	getResourceType,
} from "./browserSpanStyles";
import { SpanDetails } from "./SpanDetails";

const FOCUSED_ELEMENT_TOP_OFFSET_PX = 16;

export interface DetailsPanelProps {
	traceInfo: TraceInfo;
	hoveredElements: HoveredElements | null;
	testStartTimeMs: number;
	focusedElement: FocusedElement | null;
	onNavigateToSpan?: (spanId: string) => void;
}

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

export function DetailsPanel(props: DetailsPanelProps) {
	let containerRef: HTMLDivElement | undefined;
	let anchorFrame: number | undefined;
	// The detailsLayoutKey that produced the current bottom spacer; used to
	// decide whether the spacer is still trustworthy when focus is lost.
	let spacerLayoutKey: string | undefined;

	const [bottomSpacerHeight, setBottomSpacerHeight] = createSignal(0);

	const flatSteps = createMemo(() =>
		props.hoveredElements
			? flattenHoveredSpans(props.hoveredElements.steps)
			: [],
	);

	const allSpans = createMemo(() =>
		props.hoveredElements
			? flattenHoveredSpans(props.hoveredElements.spans)
			: [],
	);

	// Split spans by service name
	const flatBrowserSpans = createMemo(() =>
		allSpans().filter((hs) => hs.span.serviceName === "playwright-browser"),
	);

	const flatExternalSpans = createMemo(() =>
		allSpans().filter((hs) => hs.span.serviceName !== "playwright-browser"),
	);

	const isSpanFocused = (spanId: string): boolean => {
		const focused = props.focusedElement;
		return !!(
			focused &&
			(focused.type === "step" || focused.type === "span") &&
			focused.id === spanId
		);
	};

	const isScreenshotFocused = () => {
		const focused = props.focusedElement;
		return focused?.type === "screenshot";
	};

	const focusedElementSelector = (focused: FocusedElement) =>
		focused.type === "screenshot"
			? "[data-screenshot]"
			: `[data-span-id="${focused.id}"]`;

	// Memoized so downstream subscribers (the anchoring effect) only re-run
	// when the rendered content actually changes, not on every hover move.
	const detailsLayoutKey = createMemo(() => {
		const elements = props.hoveredElements;
		if (!elements) return "";

		return [
			elements.screenshot?.url ?? "",
			...flatSteps().map((hoveredSpan) => hoveredSpan.span.id),
			...flatBrowserSpans().map((hoveredSpan) => hoveredSpan.span.id),
			...flatExternalSpans().map((hoveredSpan) => hoveredSpan.span.id),
		].join("|");
	});

	const cancelAnchorFrame = () => {
		if (anchorFrame !== undefined) {
			cancelAnimationFrame(anchorFrame);
			anchorFrame = undefined;
		}
	};

	// Cancel any pending frame when the component is disposed.
	onCleanup(cancelAnchorFrame);

	const anchorFocusedElement = () => {
		cancelAnchorFrame();

		anchorFrame = requestAnimationFrame(() => {
			anchorFrame = undefined;

			// Reads here are intentionally non-reactive: rAF callbacks run
			// outside Solid's tracking scope.
			const focused = props.focusedElement;
			if (!focused || !containerRef) {
				// Keep the current spacer: removing it would shrink the
				// scroll area and jump the scroll position.
				return;
			}

			const selector = focusedElementSelector(focused);
			const element = containerRef.querySelector<HTMLElement>(selector);
			if (!element) {
				spacerLayoutKey = undefined;
				setBottomSpacerHeight(0);
				return;
			}

			// Signal writes outside a batch apply to the DOM synchronously,
			// so the spacer is in place before we measure and scroll below.
			spacerLayoutKey = detailsLayoutKey();
			setBottomSpacerHeight(
				Math.max(
					0,
					containerRef.clientHeight -
						FOCUSED_ELEMENT_TOP_OFFSET_PX -
						element.offsetHeight,
				),
			);

			const elementRect = element.getBoundingClientRect();
			const containerRect = containerRef.getBoundingClientRect();
			const elementTopInScrollArea =
				elementRect.top - containerRect.top + containerRef.scrollTop;

			containerRef.scrollTo({
				top: Math.max(
					0,
					elementTopInScrollArea - FOCUSED_ELEMENT_TOP_OFFSET_PX,
				),
				behavior: "auto",
			});
		});
	};

	createEffect(
		on(
			[() => props.focusedElement, detailsLayoutKey],
			([focused, layoutKey]) => {
				if (!focused) {
					cancelAnchorFrame();

					// Keep the spacer from the last anchored layout so a brief
					// hover-out doesn't shrink the scroll area and jump the
					// scroll position. Only clear it once the panel content
					// actually changes and the measurement is stale.
					if (spacerLayoutKey !== undefined && spacerLayoutKey !== layoutKey) {
						spacerLayoutKey = undefined;
						setBottomSpacerHeight(0);
					}
					return;
				}

				anchorFocusedElement();
			},
		),
	);

	return (
		<div
			ref={containerRef}
			data-testid="trace-details-panel"
			class="h-full overflow-auto bg-white"
		>
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
									class="bg-gray-100 rounded-md overflow-hidden border-2 transition-colors duration-150"
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
										onLoad={anchorFocusedElement}
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
												onNavigateToSpan={props.onNavigateToSpan}
											/>
										)}
									</For>
								</div>
							</div>
						</Show>

						{/* Browser Spans section */}
						<Show when={flatBrowserSpans().length > 0}>
							<div>
								<div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
									Browser Spans ({flatBrowserSpans().length})
								</div>
								<div class="space-y-2">
									<For each={flatBrowserSpans()}>
										{(hoveredSpan) => {
											const resourceType = getResourceType(hoveredSpan.span);
											return (
												<SpanDetails
													hoveredSpan={hoveredSpan}
													testStartTimeMs={props.testStartTimeMs}
													colorFn={() => getResourceColor(resourceType)}
													isFocused={isSpanFocused(hoveredSpan.span.id)}
													icon={getResourceIcon(resourceType, 16)}
													displayTitle={getResourceDisplayName(
														hoveredSpan.span,
													)}
													onNavigateToSpan={props.onNavigateToSpan}
												/>
											);
										}}
									</For>
								</div>
							</div>
						</Show>

						{/* External Spans section */}
						<Show when={flatExternalSpans().length > 0}>
							<div>
								<div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
									External Spans ({flatExternalSpans().length})
								</div>
								<div class="space-y-2">
									<For each={flatExternalSpans()}>
										{(hoveredSpan) => (
											<SpanDetails
												hoveredSpan={hoveredSpan}
												testStartTimeMs={props.testStartTimeMs}
												colorFn={(_, span) => getSpanColor(span.kind)}
												isFocused={isSpanFocused(hoveredSpan.span.id)}
												onNavigateToSpan={props.onNavigateToSpan}
											/>
										)}
									</For>
								</div>
							</div>
						</Show>

						{/* Empty state when no steps or spans */}
						<Show
							when={
								flatSteps().length === 0 &&
								flatBrowserSpans().length === 0 &&
								flatExternalSpans().length === 0
							}
						>
							<div class="text-gray-400 text-sm text-center py-4">
								No active steps or spans at this time
							</div>
						</Show>

						<Show when={bottomSpacerHeight() > 0}>
							<div
								aria-hidden="true"
								style={{ height: `${bottomSpacerHeight()}px` }}
							/>
						</Show>
					</div>
				)}
			</Show>
		</div>
	);
}
