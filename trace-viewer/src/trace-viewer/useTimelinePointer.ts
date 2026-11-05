import { createSignal, onCleanup, onMount } from "solid-js";
import { type FocusedElement, useHoverContext } from "./contexts/HoverContext";
import { useViewportContext } from "./contexts/ViewportContext";
import { timeToViewportPosition, viewportPositionToTime } from "./viewport";

/** A drag under this share of the visible time is a click, not a selection. */
const MIN_SELECTION_RATIO = 0.02;

interface TimelineSelection {
	startPosition: number;
	/** The time under the pointer when pressed, mid-animation included */
	startTimeMs: number;
	currentPosition: number;
	element: FocusedElement | null;
}

export interface TimelineSelectionRange {
	leftPercent: number;
	widthPercent: number;
}

export interface TimelinePointerOptions {
	/** The plot box of the span panels */
	plot: () => HTMLElement | undefined;
}

export interface TimelinePointer {
	/** The range being dragged over the span panels, or null */
	selection: () => TimelineSelectionRange | null;
	handleMouseDown: (event: MouseEvent) => void;
	handleMouseMove: (event: MouseEvent) => void;
	handleMouseLeave: () => void;
	/** The pointer over a span panel's bar, or off it (null) */
	hoverElement: (element: FocusedElement | null) => void;
	/**
	 * The pointer at a time on the ruler or filmstrip, which can be out of view
	 * when zoomed, or off them (null)
	 */
	hoverTime: (timeMs: number | null, element: FocusedElement | null) => void;
	/** Drops the lock and goes back to hovering wherever the pointer is. */
	unlockToPointer: () => void;
}

/** Resize handles sit over the panels, but have no time of their own. */
function isOnResizeHandle(target: EventTarget | null): boolean {
	const { cursor } = window.getComputedStyle(target as HTMLElement);
	return cursor === "col-resize" || cursor === "row-resize";
}

/**
 * The pointer over the timeline: hovering moves the time on display, a click
 * locks or unlocks it, and a drag across the span panels zooms to the range.
 * The pointer is tracked apart from the display, which stays on the lock or a
 * search result while it moves.
 */
export function useTimelinePointer(
	options: TimelinePointerOptions,
): TimelinePointer {
	const { viewport, displayedViewport, zoomToRange } = useViewportContext();
	const { mode, setHoverPosition, setHoveredElement, lock, unlock } =
		useHoverContext();

	const [selection, setSelection] = createSignal<TimelineSelection | null>(
		null,
	);
	let pointerElement: FocusedElement | null = null;
	let pointerPosition: number | null = null;

	const hoverElement = (element: FocusedElement | null) => {
		pointerElement = element;
		if (mode() === "hover") setHoveredElement(element);
	};

	const hoverTime = (timeMs: number | null, element: FocusedElement | null) => {
		pointerPosition =
			timeMs === null ? null : timeToViewportPosition(timeMs, viewport());
		hoverElement(element);
		if (mode() === "hover") setHoverPosition(pointerPosition);
	};

	const unlockToPointer = () => {
		unlock();
		setHoverPosition(pointerPosition);
		setHoveredElement(pointerElement);
	};

	const handleMouseDown = (event: MouseEvent) => {
		const plot = options.plot();
		if (event.button !== 0 || !plot || isOnResizeHandle(event.target)) return;

		const rect = plot.getBoundingClientRect();
		const position = (event.clientX - rect.left) / rect.width;
		if (position >= 0 && position <= 1) {
			setSelection({
				startPosition: position,
				startTimeMs: viewportPositionToTime(position, displayedViewport()),
				currentPosition: position,
				element: pointerElement,
			});
		}
	};

	const handleMouseMove = (event: MouseEvent) => {
		const plot = options.plot();
		if (!plot) return;

		const rect = plot.getBoundingClientRect();
		const position = (event.clientX - rect.left) / rect.width;

		const current = selection();
		if (current) {
			setSelection({
				...current,
				currentPosition: Math.max(0, Math.min(1, position)),
			});
		}

		pointerPosition =
			!isOnResizeHandle(event.target) && position >= 0 && position <= 1
				? position
				: null;
		if (mode() === "hover") setHoverPosition(pointerPosition);
	};

	const handleMouseUp = () => {
		const current = selection();
		if (!current) return;
		setSelection(null);

		// Positions are on screen, which differs from the target mid-animation.
		const shown = displayedViewport();
		const startMs = viewportPositionToTime(
			Math.min(current.startPosition, current.currentPosition),
			shown,
		);
		const endMs = viewportPositionToTime(
			Math.max(current.startPosition, current.currentPosition),
			shown,
		);

		const visibleMs = shown.visibleEndMs - shown.visibleStartMs;
		if (endMs - startMs > visibleMs * MIN_SELECTION_RATIO) {
			zoomToRange(startMs, endMs);
		} else if (mode() === "hover") {
			// Lock to the selected time so zooming does not move the lock.
			lock(current.startTimeMs, current.element);
		} else {
			// Any click unlocks, with the hover line at once where it was clicked.
			setHoverPosition(current.startPosition);
			unlock();
			setHoveredElement(pointerElement);
		}
	};

	const handleMouseLeave = () => {
		pointerPosition = null;
		hoverElement(null);
		if (mode() === "hover") setHoverPosition(null);
		// A selection carries on: the drag may come back or end outside.
	};

	onMount(() => {
		document.addEventListener("mouseup", handleMouseUp);
		onCleanup(() => document.removeEventListener("mouseup", handleMouseUp));
	});

	return {
		selection: () => {
			const current = selection();
			if (!current) return null;
			return {
				leftPercent:
					Math.min(current.startPosition, current.currentPosition) * 100,
				widthPercent:
					Math.abs(current.currentPosition - current.startPosition) * 100,
			};
		},
		handleMouseDown,
		handleMouseMove,
		handleMouseLeave,
		hoverElement,
		hoverTime,
		unlockToPointer,
	};
}
