import type { PackedSpan } from "./packSpans";

export type NavigationDirection = "left" | "right" | "up" | "down";

/** A timeline panel's packed rows, in the order panels are stacked on screen. */
export interface NavigationPanel {
	id: string;
	spans: PackedSpan[];
}

/** Where focus moves: the span to focus and the time to lock the cursor at. */
export interface NavigationTarget {
	spanId: string;
	timeMs: number;
}

const endOf = (span: PackedSpan) => span.startOffset + span.duration;
const centerOf = (span: PackedSpan) => span.startOffset + span.duration / 2;

/** Inclusive, so zero-duration bars and touching edges count. */
const containsTime = (span: PackedSpan, timeMs: number) =>
	span.startOffset <= timeMs && timeMs <= endOf(span);

/**
 * The bar the time line crosses in a row. Bars touching at the line tie; one
 * the line passes strictly through wins, then the earlier one.
 */
function barAtTime(rowSpans: PackedSpan[], timeMs: number): PackedSpan | null {
	let best: PackedSpan | null = null;
	for (const span of rowSpans) {
		if (!containsTime(span, timeMs)) continue;
		if (!best) {
			best = span;
			continue;
		}
		const isStrict = span.startOffset < timeMs && timeMs < endOf(span);
		const isBestStrict = best.startOffset < timeMs && timeMs < endOf(best);
		if (isStrict !== isBestStrict) {
			if (isStrict) best = span;
		} else if (span.startOffset < best.startOffset) {
			best = span;
		}
	}
	return best;
}

function rowsOf(spans: PackedSpan[]): PackedSpan[][] {
	const rows: PackedSpan[][] = [];
	for (const span of spans) {
		(rows[span.row] ??= []).push(span);
	}
	return rows;
}

/** Previous/next bar on the same visual row. */
function rowNeighbor(
	spans: PackedSpan[],
	current: PackedSpan,
	step: -1 | 1,
): PackedSpan | null {
	const row = spans
		.filter((span) => span.row === current.row)
		.sort((a, b) => a.startOffset - b.startOffset || a.duration - b.duration);
	const index = row.findIndex((span) => span.id === current.id);
	return row[index + step] ?? null;
}

/**
 * Walks rows from `row` in the direction of `step`, continuing into the
 * panels beyond, and returns the first bar the time line crosses.
 */
function nextAlongTimeLine(
	panels: NavigationPanel[],
	panelIndex: number,
	row: number,
	step: -1 | 1,
	timeMs: number,
): PackedSpan | null {
	for (
		let index = panelIndex;
		index >= 0 && index < panels.length;
		index += step
	) {
		const rows = rowsOf(panels[index].spans);
		let start: number;
		if (index !== panelIndex) start = step === 1 ? 0 : rows.length - 1;
		else start = row + step;
		for (let r = start; r >= 0 && r < rows.length; r += step) {
			const bar = barAtTime(rows[r] ?? [], timeMs);
			if (bar) return bar;
		}
	}
	return null;
}

/**
 * Finds where an arrow key moves focus, treating focus as a 2D cursor: a bar
 * plus the locked time line through it.
 *
 * - Left/Right: previous/next bar on the same visual row; the time line moves
 *   to that bar's center.
 * - Up/Down: the next bar the time line crosses above/below, skipping rows
 *   with nothing under the line and continuing into the panels beyond. The
 *   time line stays put, so Up and Down undo each other.
 *
 * `timeMs` is the locked time, clamped into the current span.
 *
 * @returns The target, or null when there is nowhere to move
 */
export function findSpanNavigationTarget(
	panels: NavigationPanel[],
	spanId: string,
	direction: NavigationDirection,
	timeMs: number,
): NavigationTarget | null {
	const panelIndex = panels.findIndex((panel) =>
		panel.spans.some((span) => span.id === spanId),
	);
	if (panelIndex === -1) return null;
	const spans = panels[panelIndex].spans;
	const current = spans.find((span) => span.id === spanId)!;
	const lineMs = Math.min(
		endOf(current),
		Math.max(current.startOffset, timeMs),
	);

	switch (direction) {
		case "left":
		case "right": {
			const neighbor = rowNeighbor(
				spans,
				current,
				direction === "left" ? -1 : 1,
			);
			return neighbor && { spanId: neighbor.id, timeMs: centerOf(neighbor) };
		}
		case "up":
		case "down": {
			const bar = nextAlongTimeLine(
				panels,
				panelIndex,
				current.row,
				direction === "up" ? -1 : 1,
				lineMs,
			);
			return bar && { spanId: bar.id, timeMs: lineMs };
		}
	}
}
