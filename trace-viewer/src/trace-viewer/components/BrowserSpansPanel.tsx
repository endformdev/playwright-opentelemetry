import { createMemo, For, Show } from "solid-js";
import type { Span } from "../../trace-data-loader/exportToSpans";
import { useViewportContext } from "../contexts/ViewportContext";
import { type PackedSpan, packSpans, type SpanInput } from "../packSpans";
import { isTimeRangeVisible } from "../viewport";
import {
	getResourceColor,
	getResourceDisplayName,
	getResourceIcon,
	getResourceType,
	type ResourceType,
} from "./browserSpanStyles";
import { ROW_HEIGHT, SpanBar } from "./SpanBar";

export interface BrowserSpansPanelProps {
	spans: Span[];
	onSpanHover?: (spanId: string | null) => void;
	matchedSpanIds?: Set<string>;
	hoveredSearchSpanId?: string | null;
}

function spansToSpanInput(spans: Span[]): SpanInput[] {
	return spans.map((span) => ({
		id: span.id,
		name: getResourceDisplayName(span),
		startOffset: span.startOffsetMs,
		duration: span.durationMs,
		parentId: span.parentId,
	}));
}

export function BrowserSpansPanel(props: BrowserSpansPanelProps) {
	const { viewport } = useViewportContext();

	const packedSpansResult = createMemo(() => {
		const spanInputs = spansToSpanInput(props.spans);
		return packSpans(spanInputs);
	});

	const resourceTypeMap = createMemo(() => {
		const map = new Map<string, ResourceType>();
		for (const span of props.spans) {
			map.set(span.id, getResourceType(span));
		}
		return map;
	});

	const visibleSpans = createMemo(() => {
		return packedSpansResult().spans.filter((span) =>
			isTimeRangeVisible(
				span.startOffset,
				span.startOffset + span.duration,
				viewport(),
			),
		);
	});

	const containerHeight = () => packedSpansResult().totalRows * ROW_HEIGHT;
	const isEmpty = () => props.spans.length === 0;

	return (
		<div class="h-full flex flex-col bg-gray-50 overflow-hidden">
			<div class="flex-shrink-0 px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
				Browser Spans
			</div>
			<Show
				when={!isEmpty()}
				fallback={
					<div class="flex-1 flex items-center justify-center text-sm text-gray-400">
						No browser spans
					</div>
				}
			>
				<div class="flex-1 overflow-y-auto overflow-x-hidden p-3">
					<div class="relative" style={{ height: `${containerHeight()}px` }}>
						<For each={visibleSpans()}>
							{(packedSpan: PackedSpan) => {
								const resourceType =
									resourceTypeMap().get(packedSpan.id) ?? "other";
								return (
									<SpanBar
										id={packedSpan.id}
										name={packedSpan.name}
										startOffset={packedSpan.startOffset}
										duration={packedSpan.duration}
										row={packedSpan.row}
										color={getResourceColor(resourceType)}
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
