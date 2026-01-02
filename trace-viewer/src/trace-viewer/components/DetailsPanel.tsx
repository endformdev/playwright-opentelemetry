import { createEffect, For, onCleanup, Show } from "solid-js";
import type { SpanKind } from "../../trace-data-loader/exportToSpans";
import type { TraceInfo } from "../../trace-info-loader";
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

const SCROLL_DEBOUNCE_MS = 40;
const SCROLL_TOP_PADDING_PX = 16;

type FocusedElementType = "screenshot" | "step" | "span";

interface FocusedElement {
	type: FocusedElementType;
	id: string; // span ID for steps/spans, or screenshot URL for screenshots
}

export interface DetailsPanelProps {
	traceInfo: TraceInfo;
	hoveredElements: HoveredElements | null;
	testStartTimeMs: number;
	/** Element to scroll into view (from hover/lock tracking) */
	focusedElement: FocusedElement | null;
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

	const flatSteps = () =>
		props.hoveredElements
			? flattenHoveredSpans(props.hoveredElements.steps)
			: [];

	const allSpans = () =>
		props.hoveredElements
			? flattenHoveredSpans(props.hoveredElements.spans)
			: [];

	// Split spans by service name
	const flatBrowserSpans = () =>
		allSpans().filter((hs) => hs.span.serviceName === "playwright-browser");

	const flatExternalSpans = () =>
		allSpans().filter((hs) => hs.span.serviceName !== "playwright-browser");

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

	createEffect(() => {
		const focused = props.focusedElement;
		const currentId = focused
			? focused.type === "screenshot"
				? "screenshot"
				: focused.id
			: null;

		if (!currentId || !containerRef) return;

		const selector =
			focused!.type === "screenshot"
				? "[data-screenshot]"
				: `[data-span-id="${focused!.id}"]`;

		const timeout = setTimeout(() => {
			const element = containerRef?.querySelector(selector);
			if (element && containerRef) {
				const elementRect = element.getBoundingClientRect();
				const containerRect = containerRef.getBoundingClientRect();
				const elementTopInScrollArea =
					elementRect.top - containerRect.top + containerRef.scrollTop;
				const targetScrollTop = Math.max(
					0,
					elementTopInScrollArea - SCROLL_TOP_PADDING_PX,
				);
				containerRef.scrollTo({
					top: targetScrollTop,
					behavior: "smooth",
				});
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
					</div>
				)}
			</Show>
		</div>
	);
}
