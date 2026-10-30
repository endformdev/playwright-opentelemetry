import type { PackedSpan } from "./packSpans";
import type { TimelineLayout } from "./timelineLayout";

export type NavigationDirection = "left" | "right" | "up" | "down";

/** A timeline panel's rows, in the order panels are stacked on screen. */
export type NavigationPanel = Pick<TimelineLayout, "rows" | "byId">;

/** Where focus moves: the span to focus and the time to lock the cursor at. */
export interface NavigationTarget {
	spanId: string;
	timeMs: number;
}

const endOf = (span: PackedSpan) => span.startOffset + span.duration;
const centerOf = (span: PackedSpan) => span.startOffset + span.duration / 2;

const distanceToTime = (span: PackedSpan, timeMs: number) =>
	Math.max(0, span.startOffset - timeMs, timeMs - endOf(span));

/** The line passes through the bar rather than just touching an edge. */
const crossesStrictly = (span: PackedSpan, timeMs: number) =>
	span.startOffset < timeMs && timeMs < endOf(span);

/**
 * The bar in a row nearest the time line among those overlapping a window.
 * Bars the line passes through beat bars it only touches, then earlier bars
 * win ties.
 */
function closestInWindow(
	rowSpans: PackedSpan[],
	windowStartMs: number,
	windowEndMs: number,
	timeMs: number,
): PackedSpan | null {
	let best: PackedSpan | null = null;
	for (const span of rowSpans) {
		if (span.startOffset > windowEndMs || endOf(span) < windowStartMs) {
			continue;
		}
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
		const isStrict = crossesStrictly(span, timeMs);
		if (isStrict !== crossesStrictly(best, timeMs)) {
			if (isStrict) best = span;
		} else if (span.startOffset < best.startOffset) {
			best = span;
		}
	}
	return best;
}

/** Previous/next bar on the same visual row. */
function rowNeighbor(
	panel: NavigationPanel,
	current: PackedSpan,
	step: -1 | 1,
): PackedSpan | null {
	const row = panel.rows[current.row] ?? [];
	return row[row.indexOf(current) + step] ?? null;
}

/**
 * Walks rows from `row` in the direction of `step`, continuing into the
 * panels beyond, and returns the bar nearest the time line in the first row
 * with a bar overlapping the window.
 */
function nextInWindow(
	panels: NavigationPanel[],
	panelIndex: number,
	row: number,
	step: -1 | 1,
	windowStartMs: number,
	windowEndMs: number,
	timeMs: number,
): PackedSpan | null {
	for (
		let index = panelIndex;
		index >= 0 && index < panels.length;
		index += step
	) {
		const { rows } = panels[index];
		let start: number;
		if (index !== panelIndex) start = step === 1 ? 0 : rows.length - 1;
		else start = row + step;
		for (let r = start; r >= 0 && r < rows.length; r += step) {
			const bar = closestInWindow(
				rows[r] ?? [],
				windowStartMs,
				windowEndMs,
				timeMs,
			);
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
 * - Down: into what is beneath the focused bar. The first row below with a
 *   bar under the focused bar's width (or within `slopMs` of the line, for
 *   tiny bars) wins, and within it the bar nearest the line.
 * - Up: out to what is above the line. The first row above with a bar within
 *   `slopMs` of the line wins. The focused bar's width is ignored, so Up from
 *   a wide bar does not land on something small far from the line.
 *
 * Rows with no candidate are skipped, continuing into the panels beyond. The
 * time line stays put unless the chosen bar is not under it, when it moves
 * just far enough to land on the bar.
 *
 * Up and Down follow different geometry, so Down then Up need not return to
 * where it started; `navigateWithHistory` adds that.
 *
 * @param timeMs - The locked time, clamped into the current span
 * @param slopMs - How far from the line a bar may be and still count as on it
 * @returns The target, or null when there is nowhere to move
 */
export function findSpanNavigationTarget(
	panels: NavigationPanel[],
	spanId: string,
	direction: NavigationDirection,
	timeMs: number,
	slopMs = 0,
): NavigationTarget | null {
	const panelIndex = panels.findIndex((panel) => panel.byId.has(spanId));
	if (panelIndex === -1) return null;
	const panel = panels[panelIndex];
	const current = panel.byId.get(spanId)!;
	const lineMs = Math.min(
		endOf(current),
		Math.max(current.startOffset, timeMs),
	);

	switch (direction) {
		case "left":
		case "right": {
			const neighbor = rowNeighbor(
				panel,
				current,
				direction === "left" ? -1 : 1,
			);
			return neighbor && { spanId: neighbor.id, timeMs: centerOf(neighbor) };
		}
		case "up":
		case "down": {
			const isDown = direction === "down";
			const bar = nextInWindow(
				panels,
				panelIndex,
				current.row,
				isDown ? 1 : -1,
				Math.min(isDown ? current.startOffset : lineMs, lineMs - slopMs),
				Math.max(isDown ? endOf(current) : lineMs, lineMs + slopMs),
				lineMs,
			);
			return (
				bar && {
					spanId: bar.id,
					timeMs: Math.min(endOf(bar), Math.max(bar.startOffset, lineMs)),
				}
			);
		}
	}
}

/** A move made with the arrow keys. */
export interface NavigationStep {
	direction: NavigationDirection;
	from: NavigationTarget;
	to: NavigationTarget;
}

const OPPOSITE_DIRECTION: Record<NavigationDirection, NavigationDirection> = {
	left: "right",
	right: "left",
	up: "down",
	down: "up",
};

const MAX_NAVIGATION_HISTORY = 200;

/**
 * Moves focus like `findSpanNavigationTarget`, except that pressing the
 * opposite arrow retraces the previous move, back to the same bar and time.
 * Down, Down, Up, Up always ends where it started.
 *
 * History only holds while focus stays where the last move left it: focusing
 * anything any other way (a click, a search result) starts afresh.
 *
 * @returns The target and the history to keep, or null when there is nowhere
 *   to move
 */
export function navigateWithHistory(
	panels: NavigationPanel[],
	history: NavigationStep[],
	current: NavigationTarget,
	direction: NavigationDirection,
	slopMs = 0,
): { target: NavigationTarget; history: NavigationStep[] } | null {
	const last = history.at(-1);
	const validHistory =
		last?.to.spanId === current.spanId && last.to.timeMs === current.timeMs
			? history
			: [];

	const previous = validHistory.at(-1);
	if (
		previous?.direction === OPPOSITE_DIRECTION[direction] &&
		panels.some((panel) => panel.byId.has(previous.from.spanId))
	) {
		return { target: previous.from, history: validHistory.slice(0, -1) };
	}

	const target = findSpanNavigationTarget(
		panels,
		current.spanId,
		direction,
		current.timeMs,
		slopMs,
	);
	if (!target) return null;
	return {
		target,
		history: [...validHistory, { direction, from: current, to: target }].slice(
			-MAX_NAVIGATION_HISTORY,
		),
	};
}
