import { createMemo, For, Show } from "solid-js";
import { isErrorSpan, type Span } from "../../trace-data-loader/exportToSpans";
import {
	LABEL_FADE_IN_MS,
	useViewportContext,
	useViewportTransitionTransform,
} from "../contexts/ViewportContext";
import type { PackedSpan, PackedSpansResult } from "../packSpans";
import { isTimeRangeVisible } from "../viewport";
import {
	getResourceColor,
	getResourceDisplayName,
	getResourceIcon,
	getResourceType,
	type ResourceType,
} from "./browserSpanStyles";
import { PanelCornerLabel } from "./PanelHeader";
import { ROW_HEIGHT, SpanBar } from "./SpanBar";

const ERROR_SPAN_COLOR = "#dc2626";

export interface BrowserSpansPanelProps {
	spans: Span[];
	/** Packed rows for `spans`, shared with keyboard navigation */
	layout: PackedSpansResult;
	focusedSpanId?: string | null;
	onSpanHover?: (spanId: string | null) => void;
	matchedSpanIds?: Set<string>;
	hoveredSearchSpanId?: string | null;
}

export function BrowserSpansPanel(props: BrowserSpansPanelProps) {
	const { renderViewport } = useViewportContext();
	let plotLayerRef: HTMLDivElement | undefined;
	useViewportTransitionTransform(() => plotLayerRef);

	const displayNames = createMemo(
		() =>
			new Map(
				props.spans.map((span) => [span.id, getResourceDisplayName(span)]),
			),
	);

	const resourceTypeMap = createMemo(() => {
		const map = new Map<string, ResourceType>();
		for (const span of props.spans) {
			map.set(span.id, getResourceType(span));
		}
		return map;
	});

	const errorSpanIds = createMemo(
		() => new Set(props.spans.filter(isErrorSpan).map((span) => span.id)),
	);
	const spanEvents = createMemo(
		() => new Map(props.spans.map((span) => [span.id, span.events])),
	);

	const visibleSpans = createMemo(() => {
		return props.layout.spans.filter((span) =>
			isTimeRangeVisible(
				span.startOffset,
				span.startOffset + span.duration,
				renderViewport(),
			),
		);
	});

	const containerHeight = () => props.layout.totalRows * ROW_HEIGHT;
	const isEmpty = () => props.spans.length === 0;

	return (
		<div
			class="relative h-full flex flex-col bg-gray-50 overflow-hidden"
			role="region"
			aria-label="Browser Spans"
		>
			<PanelCornerLabel title="Browser Spans" />
			<Show
				when={!isEmpty()}
				fallback={
					<div class="flex-1 flex items-center justify-center text-sm text-gray-400">
						No browser spans
					</div>
				}
			>
				<div
					class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-3"
					role="list"
				>
					<div
						ref={plotLayerRef}
						class="group/plot relative"
						style={{
							"--label-fade-in": `${LABEL_FADE_IN_MS}ms`,
							height: `${containerHeight()}px`,
							"margin-left": "var(--timeline-plot-inset)",
							width: "var(--timeline-plot-width)",
						}}
					>
						<For each={visibleSpans()}>
							{(packedSpan: PackedSpan) => {
								const resourceType =
									resourceTypeMap().get(packedSpan.id) ?? "other";
								const isError = errorSpanIds().has(packedSpan.id);
								return (
									<SpanBar
										id={packedSpan.id}
										name={displayNames().get(packedSpan.id) ?? packedSpan.name}
										startOffset={packedSpan.startOffset}
										duration={packedSpan.duration}
										row={packedSpan.row}
										color={
											isError
												? ERROR_SPAN_COLOR
												: getResourceColor(resourceType)
										}
										isError={isError}
										isFocused={props.focusedSpanId === packedSpan.id}
										events={spanEvents().get(packedSpan.id)}
										icon={getResourceIcon(resourceType)}
										onHover={props.onSpanHover}
										matchedSpanIds={props.matchedSpanIds}
										hoveredSearchSpanId={props.hoveredSearchSpanId}
									/>
								);
							}}
						</For>
					</div>
				</div>
			</Show>
		</div>
	);
}
