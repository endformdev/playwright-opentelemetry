import { createMemo, For, type JSX } from "solid-js";
import type { Span, SpanKind } from "../../trace-data-loader/exportToSpans";
import { useViewportContext } from "../contexts/ViewportContext";
import {
	generateConnectors,
	type PackedSpan,
	packSpans,
	type SpanConnector,
	type SpanInput,
} from "../packSpans";
import { isTimeRangeVisible, timeToViewportPosition } from "../viewport";

const ROW_HEIGHT = 28;

export interface SpansPanelProps {
	spans: Span[];
	onSpanHover?: (spanId: string | null) => void;
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

export function SpansPanel(props: SpansPanelProps) {
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
		const kind = kindMap().get(packedSpan.id) ?? "internal";

		return (
			// biome-ignore lint/a11y/noStaticElementInteractions: hover tracking for scroll-to-span feature
			<div
				class="absolute h-6 rounded text-xs flex items-center px-2 text-white truncate cursor-pointer hover:brightness-110"
				style={{
					left: `${leftPercent()}%`,
					width: `${Math.max(widthPercent(), 2)}%`,
					top: `${packedSpan.row * ROW_HEIGHT}px`,
					"background-color": getSpanColor(kind),
				}}
				title={`${packedSpan.name} (${packedSpan.duration}ms)`}
				onMouseEnter={() => props.onSpanHover?.(packedSpan.id)}
				onMouseLeave={() => props.onSpanHover?.(null)}
			>
				{packedSpan.name}
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

	return (
		<div class="h-full flex flex-col bg-gray-50 overflow-hidden">
			<div class="flex-shrink-0 px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
				Spans
			</div>
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
		</div>
	);
}
