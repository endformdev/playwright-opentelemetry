import { createMemo, For, type JSX, Show } from "solid-js";
import type { Span } from "../../trace-data-loader/exportToSpans";
import { useViewportContext } from "../contexts/ViewportContext";
import {
	generateConnectors,
	type PackedSpan,
	packSpans,
	type SpanConnector,
	type SpanInput,
} from "../packSpans";
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

	const visibleConnectors = createMemo(() => {
		const visibleIds = new Set(visibleSpans().map((s) => s.id));
		return generateConnectors(packedSpansResult().spans, durationMs()).filter(
			(c) => visibleIds.has(c.parentId) || visibleIds.has(c.childId),
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

		return (
			// biome-ignore lint/a11y/noStaticElementInteractions: hover tracking for scroll-to-span feature
			<div
				class="absolute h-6 rounded text-xs flex items-center gap-1.5 px-2 text-white truncate cursor-pointer hover:brightness-110 select-none"
				classList={{
					"ring-2 ring-yellow-400 ring-offset-1": shouldHighlight(),
				}}
				style={{
					left: `${leftPercent()}%`,
					width: `${Math.max(widthPercent(), 2)}%`,
					top: `${packedSpan.row * ROW_HEIGHT}px`,
					"background-color": getResourceColor(resourceType),
				}}
				title={`${packedSpan.name} (${packedSpan.duration}ms)`}
				onMouseEnter={() => props.onSpanHover?.(packedSpan.id)}
				onMouseLeave={() => props.onSpanHover?.(null)}
			>
				{getResourceIcon(resourceType)}
				<span class="truncate select-none">{packedSpan.name}</span>
			</div>
		);
	};

	const renderConnector = (connector: SpanConnector): JSX.Element => {
		const rowDiff = connector.childRow - connector.parentRow;
		const topPx = connector.parentRow * ROW_HEIGHT + 24; // Start just below parent span (24px = 6 row height)
		const heightPx = (rowDiff - 1) * ROW_HEIGHT + 4; // Connect to child span

		const xPercent = () => {
			const xPositionMs = (connector.xPercent / 100) * durationMs();
			return timeToViewportPosition(xPositionMs, viewport()) * 100;
		};

		return (
			<div
				class="absolute w-px bg-gray-400"
				style={{
					left: `${xPercent()}%`,
					top: `${topPx}px`,
					height: `${heightPx}px`,
				}}
			/>
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
						{/* Render connector lines first (behind spans) */}
						<For each={visibleConnectors()}>
							{(connector) => renderConnector(connector)}
						</For>
						{/* Render spans on top */}
						<For each={visibleSpans()}>
							{(packedSpan) => renderSpan(packedSpan)}
						</For>
					</div>
				</div>
			</Show>
		</div>
	);
}
