import type { JSX } from "solid-js";
import { useViewportContext } from "../contexts/ViewportContext";
import type { TimelineViewport } from "../viewport";
import { timeToViewportPosition } from "../viewport";

/** Height of each span row in pixels */
export const ROW_HEIGHT = 28;

/** Minimum width percentage to show text content inside span */
const MIN_VISIBLE_WIDTH_PERCENT = 2;

// ============================================================================
// Span Geometry Helpers
// ============================================================================

export interface SpanGeometry {
	/** Left position as percentage (0-100) */
	leftPercent: number;
	/** Width as percentage of viewport */
	widthPercent: number;
	/** Display width (adjusted for very narrow spans) */
	displayWidthPercent: number;
	/** Whether the span is wide enough to show text content */
	shouldShowContent: boolean;
}

/**
 * Calculate the geometry of a span bar based on its timing and the current viewport.
 */
export function calculateSpanGeometry(
	startOffset: number,
	duration: number,
	viewport: TimelineViewport,
): SpanGeometry {
	const leftPercent = timeToViewportPosition(startOffset, viewport) * 100;
	const rightPercent =
		timeToViewportPosition(startOffset + duration, viewport) * 100;
	const widthPercent = rightPercent - leftPercent;
	const displayWidthPercent =
		widthPercent > MIN_VISIBLE_WIDTH_PERCENT
			? widthPercent
			: widthPercent - 0.1;
	const shouldShowContent = widthPercent > MIN_VISIBLE_WIDTH_PERCENT;

	return { leftPercent, widthPercent, displayWidthPercent, shouldShowContent };
}

/**
 * Determine if a span should be highlighted based on search state.
 */
export function calculateHighlight(
	spanId: string,
	matchedSpanIds?: Set<string>,
	hoveredSearchSpanId?: string | null,
): boolean {
	// If hovering a specific search result, only highlight that one
	// Otherwise, highlight all matched spans
	return hoveredSearchSpanId
		? spanId === hoveredSearchSpanId
		: (matchedSpanIds?.has(spanId) ?? false);
}

// ============================================================================
// SpanBar Component
// ============================================================================

export interface SpanBarProps {
	id: string;
	name: string;
	startOffset: number;
	duration: number;
	row: number;
	color: string;
	/** Optional icon to display before the span name */
	icon?: JSX.Element;
	onHover?: (spanId: string | null) => void;
	matchedSpanIds?: Set<string>;
	hoveredSearchSpanId?: string | null;
}

export function SpanBar(props: SpanBarProps) {
	const { viewport } = useViewportContext();

	const geometry = () =>
		calculateSpanGeometry(props.startOffset, props.duration, viewport());

	const shouldHighlight = () =>
		calculateHighlight(
			props.id,
			props.matchedSpanIds,
			props.hoveredSearchSpanId,
		);

	const displayText = () => {
		if (!geometry().shouldShowContent) {
			return null;
		}
		return (
			<>
				{props.icon}
				<span class="truncate select-none">{props.name}</span>
			</>
		);
	};

	return (
		<div
			class="absolute h-6 rounded-xs text-xs flex items-center gap-1.5 text-white truncate cursor-pointer hover:brightness-110 select-none"
			classList={{
				"ring-2 ring-yellow-400 ring-offset-1": shouldHighlight(),
				"px-2": geometry().shouldShowContent,
			}}
			style={{
				left: `${geometry().leftPercent}%`,
				width: `${geometry().displayWidthPercent}%`,
				top: `${props.row * ROW_HEIGHT}px`,
				"background-color": props.color,
			}}
			title={`${props.name} (${props.duration}ms)`}
			onMouseEnter={() => props.onHover?.(props.id)}
			onMouseLeave={() => props.onHover?.(null)}
		>
			{displayText()}
		</div>
	);
}
