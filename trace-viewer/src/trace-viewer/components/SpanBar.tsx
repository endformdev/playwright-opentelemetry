import { For, type JSX } from "solid-js";
import type { SpanEvent } from "../../trace-data-loader/exportToSpans";
import { useViewportContext } from "../contexts/ViewportContext";
import type { TimelineViewport } from "../viewport";
import { timeToViewportPosition } from "../viewport";
import { getSpanEventSeverity } from "./spanEventStyles";

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
	const shouldShowContent = widthPercent > MIN_VISIBLE_WIDTH_PERCENT;

	return {
		leftPercent,
		widthPercent,
		shouldShowContent,
	};
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
	isError?: boolean;
	events?: SpanEvent[];
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

	const eventLeftPercent = (event: SpanEvent) => {
		const eventViewportPercent =
			timeToViewportPosition(
				props.startOffset + event.timeOffsetMs,
				viewport(),
			) * 100;
		const spanGeometry = geometry();
		const percentWithinBar =
			((eventViewportPercent - spanGeometry.leftPercent) /
				spanGeometry.displayWidthPercent) *
			100;
		return Math.max(0, Math.min(100, percentWithinBar));
	};

	return (
		<div
			role="listitem"
			aria-label={props.name}
			data-span-id={props.id}
			data-span-name={props.name}
			data-span-start-ms={props.startOffset}
			data-span-duration-ms={props.duration}
			data-span-end-ms={props.startOffset + props.duration}
			data-span-row={props.row}
			data-span-error={props.isError ? "true" : undefined}
			class="absolute h-6 rounded-xs border-r border-gray-50 text-xs flex items-center gap-1.5 text-white truncate cursor-pointer hover:brightness-110 select-none"
			classList={{
				"ring-2 ring-yellow-400 ring-offset-1": shouldHighlight(),
				"px-2": geometry().shouldShowContent,
			}}
			style={{
				left: `${geometry().leftPercent}%`,
				width: `${geometry().widthPercent}%`,
				top: `${props.row * ROW_HEIGHT}px`,
				"background-color": props.color,
			}}
			title={`${props.name} (${props.duration}ms)`}
			onMouseEnter={() => props.onHover?.(props.id)}
			onMouseLeave={() => props.onHover?.(null)}
		>
			{displayText()}
			<For each={props.events ?? []}>
				{(event, index) => (
					<div
						data-testid="span-event-marker"
						data-span-event-name={event.name}
						data-span-event-index={index()}
						data-span-event-error={
							getSpanEventSeverity(event) === "error" ? "true" : undefined
						}
						class="absolute top-1 bottom-1 w-2 rounded-full border pointer-events-auto shadow-sm"
						classList={{
							"bg-red-200/95 border-red-700/70":
								getSpanEventSeverity(event) === "error",
							"bg-amber-200/95 border-amber-700/70":
								getSpanEventSeverity(event) === "warning",
							"bg-white/75 border-black/20":
								getSpanEventSeverity(event) === "default",
						}}
						style={{
							left: `${eventLeftPercent(event)}%`,
							"margin-left": "-4px",
						}}
						title={eventTooltip(event)}
					/>
				)}
			</For>
		</div>
	);
}

function eventTooltip(event: SpanEvent): string {
	const message =
		event.attributes["exception.message"] ?? event.attributes.message;
	return typeof message === "string" && message.length > 0
		? message
		: event.name;
}
