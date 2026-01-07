import { createMemo, For, type JSX, Show } from "solid-js";
import type { Span } from "../../trace-data-loader/exportToSpans";
import { useViewportContext } from "../contexts/ViewportContext";
import { type PackedSpan, packSpans, type SpanInput } from "../packSpans";
import { isTimeRangeVisible, timeToViewportPosition } from "../viewport";
import {
	getResourceColor,
	getResourceDisplayName,
	getResourceIcon,
	getResourceType,
	type ResourceType,
} from "./browserSpanStyles";

const ROW_HEIGHT = 28;

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
	const { viewport, durationMs } = useViewportContext();

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

	const renderSpan = (packedSpan: PackedSpan): JSX.Element => {
		const leftPercent = () =>
			timeToViewportPosition(packedSpan.startOffset, viewport()) * 100;
		const rightPercent = () =>
			timeToViewportPosition(
				packedSpan.startOffset + packedSpan.duration,
				viewport(),
			) * 100;
		const widthPercent = () => rightPercent() - leftPercent();
		const resourceType = resourceTypeMap().get(packedSpan.id) ?? "other";

		// Make shouldHighlight a function to ensure reactivity
		const shouldHighlight = () => {
			// If hovering a specific search result, only highlight that one
			// Otherwise, highlight all matched spans
			return props.hoveredSearchSpanId
				? packedSpan.id === props.hoveredSearchSpanId
				: props.matchedSpanIds?.has(packedSpan.id);
		};

		const displayText = () => {
			if (widthPercent() > 2) {
				return (
					<>
						{getResourceIcon(resourceType)}
						<span class="truncate select-none">{packedSpan.name}</span>
					</>
				);
			}
			return null;
		};

		const shouldHavePadding = () => widthPercent() > 2;

		const displayWidthPercent = () =>
			widthPercent() > 2 ? widthPercent() : widthPercent() - 0.1;

		return (
			<div
				class="absolute h-6 rounded-xs text-xs flex items-center gap-1.5 text-white truncate cursor-pointer hover:brightness-110 select-none"
				classList={{
					"ring-2 ring-yellow-400 ring-offset-1": shouldHighlight(),
					"px-2": shouldHavePadding(),
				}}
				style={{
					left: `${leftPercent()}%`,
					width: `${displayWidthPercent()}%`,
					top: `${packedSpan.row * ROW_HEIGHT}px`,
					"background-color": getResourceColor(resourceType),
				}}
				title={`${packedSpan.name} (${packedSpan.duration}ms)`}
				onMouseEnter={() => props.onSpanHover?.(packedSpan.id)}
				onMouseLeave={() => props.onSpanHover?.(null)}
			>
				{displayText()}
			</div>
		);
	};

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
							{(packedSpan) => renderSpan(packedSpan)}
						</For>
					</div>
				</div>
			</Show>
		</div>
	);
}
