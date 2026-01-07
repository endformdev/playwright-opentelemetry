import { createMemo, For, type JSX, Show } from "solid-js";
import type { Span, SpanKind } from "../../trace-data-loader/exportToSpans";
import { useViewportContext } from "../contexts/ViewportContext";
import { type PackedSpan, packSpans, type SpanInput } from "../packSpans";
import { isTimeRangeVisible, timeToViewportPosition } from "../viewport";

const ROW_HEIGHT = 28;

export interface ExternalSpansPanelProps {
	spans: Span[];
	onSpanHover?: (spanId: string | null) => void;
	matchedSpanIds?: Set<string>;
	hoveredSearchSpanId?: string | null;
}

function spansToSpanInput(spans: Span[]): SpanInput[] {
	return spans.map((span) => ({
		id: span.id,
		name: span.title,
		startOffset: span.startOffsetMs,
		duration: span.durationMs,
		parentId: span.parentId,
	}));
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

export function ExternalSpansPanel(props: ExternalSpansPanelProps) {
	const { viewport, durationMs } = useViewportContext();

	const packedSpansResult = createMemo(() => {
		const spanInputs = spansToSpanInput(props.spans);
		return packSpans(spanInputs);
	});

	const kindMap = createMemo(() => {
		const map = new Map<string, SpanKind>();
		for (const span of props.spans) {
			map.set(span.id, span.kind);
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
		const kind = kindMap().get(packedSpan.id) ?? "internal";

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
				return packedSpan.name;
			}
			return null;
		};

		const shouldHavePadding = () => widthPercent() > 2;

		const displayWidthPercent = () =>
			widthPercent() > 2 ? widthPercent() : widthPercent() - 0.1;

		return (
			<div
				class="absolute h-6 rounded text-xs flex items-center text-white truncate cursor-pointer hover:brightness-110 select-none"
				classList={{
					"ring-2 ring-yellow-400 ring-offset-1": shouldHighlight(),
					"px-2": shouldHavePadding(),
				}}
				style={{
					left: `${leftPercent()}%`,
					width: `${displayWidthPercent()}%`,
					top: `${packedSpan.row * ROW_HEIGHT}px`,
					"background-color": getSpanColor(kind),
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
				External Spans
			</div>
			<Show
				when={!isEmpty()}
				fallback={
					<div class="flex-1 flex items-center justify-center text-sm text-gray-400">
						No external spans
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
