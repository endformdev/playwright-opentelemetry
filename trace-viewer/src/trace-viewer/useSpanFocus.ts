import { type Accessor, batch, createSignal, untrack } from "solid-js";
import type { FocusedElementType } from "./contexts/HoverContext";
import { useHoverContext } from "./contexts/HoverContext";
import { useViewportContext } from "./contexts/ViewportContext";
import {
	type NavigationDirection,
	type NavigationStep,
	navigateWithHistory,
} from "./spanNavigation";
import {
	getSpanSelectionTimeMs,
	type SpanSelectionPlacement,
} from "./spanSelection";
import type { TimelineBar, TimelineLayout } from "./timelineLayout";
import { frameTimeRange, getVisibleDuration } from "./viewport";

/** How close to the time line a bar counts as on it for Up/Down */
const NAVIGATION_SLOP_PX = 24;

/** A span panel as focus sees it, in the order panels are stacked on screen. */
export interface FocusablePanel {
	elementType: Exclude<FocusedElementType, "screenshot">;
	layout: TimelineLayout<TimelineBar>;
}

export interface SpanFocusOptions {
	panels: Accessor<FocusablePanel[]>;
	/** Where arrow keys start when nothing is focused */
	startSpanId: Accessor<string | null>;
	plotWidthPx: () => number;
}

export interface SpanFocus {
	/** The locked span, or null while hovering */
	focusedSpanId: Accessor<string | null>;
	/**
	 * Selects a span: frames it in the timeline, locks time at `at` (a
	 * placement within the span, or a time) and scrolls its bar into view.
	 * Every way of going to a span should come through here.
	 */
	focusSpan: (spanId: string, at?: SpanSelectionPlacement | number) => void;
	/** Moves focus with an arrow key, starting at `startSpanId` if unfocused. */
	navigate: (direction: NavigationDirection) => void;
	/** The latest request for a panel to scroll a bar into view */
	revealRequest: Accessor<{ spanId: string } | null>;
}

export function useSpanFocus(options: SpanFocusOptions): SpanFocus {
	const { viewport, animateTo } = useViewportContext();
	const { mode, lockedElement, lockedTimeMs, lock } = useHoverContext();
	const [revealRequest, setRevealRequest] = createSignal<{
		spanId: string;
	} | null>(null);
	let history: NavigationStep[] = [];

	const findBar = (spanId: string) => {
		for (const panel of options.panels()) {
			const bar = panel.layout.byId.get(spanId);
			if (bar) return { panel, bar };
		}
		return null;
	};

	const focusedSpanId = () => {
		if (mode() === "hover") return null;
		const element = lockedElement();
		return element && element.type !== "screenshot" ? element.id : null;
	};

	const focusSpan = (
		spanId: string,
		at: SpanSelectionPlacement | number = "center",
	) => {
		const found = untrack(() => findBar(spanId));
		if (!found) return;
		const { span } = found.bar;
		batch(() => {
			animateTo(
				frameTimeRange(
					untrack(viewport),
					span.startOffsetMs,
					span.startOffsetMs + span.durationMs,
				),
			);
			lock(typeof at === "number" ? at : getSpanSelectionTimeMs(span, at), {
				type: found.panel.elementType,
				id: spanId,
			});
			setRevealRequest({ spanId });
		});
	};

	const navigate = (direction: NavigationDirection) => {
		const currentId = untrack(focusedSpanId);
		const current = currentId ? untrack(() => findBar(currentId)) : null;
		if (!current) {
			const startId = untrack(options.startSpanId);
			if (startId) focusSpan(startId);
			return;
		}

		const plotWidthPx = options.plotWidthPx();
		const slopMs =
			plotWidthPx > 0
				? (NAVIGATION_SLOP_PX * getVisibleDuration(untrack(viewport))) /
					plotWidthPx
				: 0;
		const result = navigateWithHistory(
			untrack(options.panels).map((panel) => panel.layout),
			history,
			{
				spanId: current.bar.id,
				timeMs:
					untrack(lockedTimeMs) ??
					getSpanSelectionTimeMs(current.bar.span, "center"),
			},
			direction,
			slopMs,
		);
		if (!result) return;
		history = result.history;
		focusSpan(result.target.spanId, result.target.timeMs);
	};

	return { focusedSpanId, focusSpan, navigate, revealRequest };
}
