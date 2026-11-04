import type { Span } from "../trace-data-loader/exportToSpans";
import { type PackedSpan, packSpans } from "./packSpans";

/** A packed bar together with the trace span it draws. */
export interface TimelineBar extends PackedSpan {
	span: Span;
}

/**
 * The rows of one timeline panel. Rendering and keyboard navigation both read
 * the same layout, so arrow keys move between bars as they appear on screen.
 */
export interface TimelineLayout<Bar extends PackedSpan = PackedSpan> {
	bars: Bar[];
	/** Bars on each row, ordered by start time, then shortest first */
	rows: Bar[][];
	byId: Map<string, Bar>;
}

export function createTimelineLayout<Bar extends PackedSpan>(packed: {
	spans: Bar[];
	totalRows: number;
}): TimelineLayout<Bar> {
	const rows: Bar[][] = Array.from({ length: packed.totalRows }, () => []);
	for (const bar of packed.spans) {
		rows[bar.row].push(bar);
	}
	for (const row of rows) {
		row.sort(
			(a, b) => a.startOffset - b.startOffset || a.duration - b.duration,
		);
	}
	return {
		bars: packed.spans,
		rows,
		byId: new Map(packed.spans.map((bar) => [bar.id, bar])),
	};
}

/**
 * Packs trace spans into timeline rows. Rows depend only on timing and
 * hierarchy; how a bar is labelled is up to the panel drawing it.
 */
export function layoutTimelineSpans(
	spans: Span[],
): TimelineLayout<TimelineBar> {
	const spanById = new Map(spans.map((span) => [span.id, span]));
	const packed = packSpans(
		spans.map((span) => ({
			id: span.id,
			name: span.title,
			startOffset: span.startOffsetMs,
			duration: span.durationMs,
			parentId: span.parentId,
		})),
	);
	return createTimelineLayout({
		spans: packed.spans.map((bar) => ({ ...bar, span: spanById.get(bar.id)! })),
		totalRows: packed.totalRows,
	});
}
