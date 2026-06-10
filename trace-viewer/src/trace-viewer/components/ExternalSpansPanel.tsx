import { createMemo, For, Show } from "solid-js";
import {
	isErrorSpan,
	type Span,
	type SpanKind,
} from "../../trace-data-loader/exportToSpans";
import { useViewportContext } from "../contexts/ViewportContext";
import { type PackedSpan, packSpans, type SpanInput } from "../packSpans";
import { isTimeRangeVisible } from "../viewport";
import { ROW_HEIGHT, SpanBar } from "./SpanBar";

const ERROR_SPAN_COLOR = "#dc2626";

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
	const { viewport } = useViewportContext();

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

	const errorSpanIds = createMemo(
		() => new Set(props.spans.filter(isErrorSpan).map((span) => span.id)),
	);
	const spanEvents = createMemo(
		() => new Map(props.spans.map((span) => [span.id, span.events])),
	);

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
		<div
			class="h-full flex flex-col bg-gray-50 overflow-hidden"
			role="region"
			aria-label="External Spans"
		>
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
				<div class="flex-1 overflow-y-auto overflow-x-hidden p-3" role="list">
					<div class="relative" style={{ height: `${containerHeight()}px` }}>
						<For each={visibleSpans()}>
							{(packedSpan: PackedSpan) => {
								const kind = kindMap().get(packedSpan.id) ?? "internal";
								const isError = errorSpanIds().has(packedSpan.id);
								return (
									<SpanBar
										id={packedSpan.id}
										name={packedSpan.name}
										startOffset={packedSpan.startOffset}
										duration={packedSpan.duration}
										row={packedSpan.row}
										color={isError ? ERROR_SPAN_COLOR : getSpanColor(kind)}
										isError={isError}
										events={spanEvents().get(packedSpan.id)}
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
