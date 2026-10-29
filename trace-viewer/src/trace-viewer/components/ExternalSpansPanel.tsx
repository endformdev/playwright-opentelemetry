import { createMemo, For, Show } from "solid-js";
import {
	isErrorSpan,
	type Span,
	type SpanKind,
} from "../../trace-data-loader/exportToSpans";
import { useViewportContext } from "../contexts/ViewportContext";
import type { PackedSpan, PackedSpansResult } from "../packSpans";
import { isTimeRangeVisible } from "../viewport";
import { PanelCornerLabel } from "./PanelHeader";
import { ROW_HEIGHT, SpanBar } from "./SpanBar";

const ERROR_SPAN_COLOR = "#dc2626";

export interface ExternalSpansPanelProps {
	spans: Span[];
	/** Packed rows for `spans`, shared with keyboard navigation */
	layout: PackedSpansResult;
	focusedSpanId?: string | null;
	onSpanHover?: (spanId: string | null) => void;
	matchedSpanIds?: Set<string>;
	hoveredSearchSpanId?: string | null;
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
		return props.layout.spans.filter((span) =>
			isTimeRangeVisible(
				span.startOffset,
				span.startOffset + span.duration,
				viewport(),
			),
		);
	});

	const containerHeight = () => props.layout.totalRows * ROW_HEIGHT;
	const isEmpty = () => props.spans.length === 0;

	return (
		<div
			class="relative h-full flex flex-col bg-gray-50 overflow-hidden"
			role="region"
			aria-label="External Spans"
		>
			<PanelCornerLabel title="External Spans" />
			<Show
				when={!isEmpty()}
				fallback={
					<div class="flex-1 flex items-center justify-center text-sm text-gray-400">
						No external spans
					</div>
				}
			>
				<div
					class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-3"
					role="list"
				>
					<div
						class="relative"
						style={{
							height: `${containerHeight()}px`,
							"margin-left": "var(--timeline-plot-inset)",
							width: "var(--timeline-plot-width)",
						}}
					>
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
										isFocused={props.focusedSpanId === packedSpan.id}
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
