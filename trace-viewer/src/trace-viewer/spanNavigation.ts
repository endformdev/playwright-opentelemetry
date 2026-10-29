import type { PackedSpan } from "./packSpans";

export type NavigationDirection = "left" | "right" | "up" | "down";

/** A timeline panel's packed rows, in the order panels are stacked on screen. */
export interface NavigationPanel {
	id: string;
	spans: PackedSpan[];
}

const endOf = (span: PackedSpan) => span.startOffset + span.duration;

/** Inclusive, so zero-duration spans overlap the spans they touch. */
const rangesOverlap = (a: PackedSpan, b: PackedSpan) =>
	a.startOffset <= endOf(b) && b.startOffset <= endOf(a);

const distanceToTime = (span: PackedSpan, timeMs: number) =>
	Math.max(0, span.startOffset - timeMs, timeMs - endOf(span));

/** Picks the span nearest a time; ties go to the earlier span, then `preferRow`. */
function closestToTime(
	spans: PackedSpan[],
	timeMs: number,
	preferRow: "top" | "bottom" = "top",
): PackedSpan | null {
	let best: PackedSpan | null = null;
	for (const span of spans) {
		if (!best) {
			best = span;
			continue;
		}
		const distance = distanceToTime(span, timeMs);
		const bestDistance = distanceToTime(best, timeMs);
		if (distance !== bestDistance) {
			if (distance < bestDistance) best = span;
			continue;
		}
		if (span.row !== best.row) {
			if (preferRow === "top" ? span.row < best.row : span.row > best.row) {
				best = span;
			}
			continue;
		}
		if (span.startOffset < best.startOffset) best = span;
	}
	return best;
}

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

/** Nearest row above or below holding a span that overlaps `current`. */
function overlappingInNearestRow(
	spans: PackedSpan[],
	current: PackedSpan,
	step: -1 | 1,
	timeMs: number,
): PackedSpan | null {
	const candidates = spans.filter(
		(span) =>
			span.id !== current.id &&
			Math.sign(span.row - current.row) === step &&
			rangesOverlap(span, current),
	);
	if (candidates.length === 0) return null;
	const nearestRow =
		step === 1
			? Math.min(...candidates.map((span) => span.row))
			: Math.max(...candidates.map((span) => span.row));
	return closestToTime(
		candidates.filter((span) => span.row === nearestRow),
		timeMs,
	);
}

/**
 * Finds the span an arrow key moves focus to.
 *
 * - Left/Right: previous/next bar on the same visual row.
 * - Up: the parent, else the nearest overlapping bar in a row above, else the
 *   deepest bar at `timeMs` in a panel above.
 * - Down: the child nearest `timeMs`, else the nearest overlapping bar in a row
 *   below, else the shallowest bar at `timeMs` in a panel below.
 *
 * `timeMs` is the locked time, clamped into the current span, so moving down
 * picks the child under the time cursor.
 *
 * @returns The target span ID, or null when there is nowhere to move
 */
export function findSpanNavigationTarget(
	panels: NavigationPanel[],
	spanId: string,
	direction: NavigationDirection,
	timeMs: number,
): string | null {
	const panelIndex = panels.findIndex((panel) =>
		panel.spans.some((span) => span.id === spanId),
	);
	if (panelIndex === -1) return null;
	const spans = panels[panelIndex].spans;
	const current = spans.find((span) => span.id === spanId)!;
	const referenceMs = Math.min(
		endOf(current),
		Math.max(current.startOffset, timeMs),
	);

	switch (direction) {
		case "left":
			return rowNeighbor(spans, current, -1)?.id ?? null;
		case "right":
			return rowNeighbor(spans, current, 1)?.id ?? null;
		case "up": {
			const parent = spans.find((span) => span.id === current.parentId);
			if (parent) return parent.id;
			const above = overlappingInNearestRow(spans, current, -1, referenceMs);
			if (above) return above.id;
			for (let index = panelIndex - 1; index >= 0; index--) {
				const entry = closestToTime(panels[index].spans, referenceMs, "bottom");
				if (entry) return entry.id;
			}
			return null;
		}
		case "down": {
			const child = closestToTime(
				spans.filter((span) => span.parentId === current.id),
				referenceMs,
			);
			if (child) return child.id;
			const below = overlappingInNearestRow(spans, current, 1, referenceMs);
			if (below) return below.id;
			for (let index = panelIndex + 1; index < panels.length; index++) {
				const entry = closestToTime(panels[index].spans, referenceMs, "top");
				if (entry) return entry.id;
			}
			return null;
		}
	}
}
