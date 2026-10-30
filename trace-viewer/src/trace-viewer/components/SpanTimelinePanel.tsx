import { createEffect, createMemo, For, on } from "solid-js";
import { isErrorSpan } from "../../trace-data-loader/exportToSpans";
import {
	LABEL_FADE_IN_MS,
	useViewportContext,
	useViewportLayer,
} from "../contexts/ViewportContext";
import type { TimelineBar, TimelineLayout } from "../timelineLayout";
import { isTimeRangeVisible } from "../viewport";
import { PanelCornerLabel } from "./PanelHeader";
import { BAR_HEIGHT, ROW_HEIGHT, SpanBar } from "./SpanBar";
import type { TimelinePanelDefinition } from "./timelinePanels";

const ERROR_SPAN_COLOR = "#dc2626";
/** Space above the first row and below the last */
const PLOT_PADDING_Y_PX = 12;
/** Room kept around a revealed bar; more below, clear of the corner label */
const REVEAL_MARGIN_TOP_PX = ROW_HEIGHT / 2;
const REVEAL_MARGIN_BOTTOM_PX = ROW_HEIGHT;

export interface SpanTimelinePanelProps {
	definition: TimelinePanelDefinition;
	layout: TimelineLayout<TimelineBar>;
	focusedSpanId: string | null;
	/** Scrolls the bar's row into view each time a new request arrives */
	revealRequest: { spanId: string } | null;
	onBarHover: (spanId: string | null) => void;
	matchedSpanIds?: Set<string>;
	hoveredSearchSpanId?: string | null;
}

/** A vertically scrolling panel of span bars, one per packed row slot. */
export function SpanTimelinePanel(props: SpanTimelinePanelProps) {
	const { renderViewport } = useViewportContext();
	let scrollerRef: HTMLDivElement | undefined;
	let layerRef: HTMLDivElement | undefined;
	useViewportLayer(() => layerRef);

	const spans = createMemo(() => props.layout.bars.map((bar) => bar.span));
	const appearanceOf = props.definition.createAppearance(spans);

	const visibleBars = createMemo(() =>
		props.layout.bars.filter((bar) =>
			isTimeRangeVisible(
				bar.startOffset,
				bar.startOffset + bar.duration,
				renderViewport(),
			),
		),
	);

	createEffect(
		on(
			() => props.revealRequest,
			(request) => {
				const bar = request && props.layout.byId.get(request.spanId);
				if (!bar || !scrollerRef) return;
				const top = PLOT_PADDING_Y_PX + bar.row * ROW_HEIGHT;
				const bottom = top + BAR_HEIGHT;
				if (top - REVEAL_MARGIN_TOP_PX < scrollerRef.scrollTop) {
					scrollerRef.scrollTop = top - REVEAL_MARGIN_TOP_PX;
				} else if (
					bottom + REVEAL_MARGIN_BOTTOM_PX >
					scrollerRef.scrollTop + scrollerRef.clientHeight
				) {
					scrollerRef.scrollTop =
						bottom + REVEAL_MARGIN_BOTTOM_PX - scrollerRef.clientHeight;
				}
			},
			{ defer: true },
		),
	);

	return (
		<div
			class="relative h-full flex flex-col bg-gray-50 overflow-hidden"
			role="region"
			aria-label={props.definition.title}
		>
			<PanelCornerLabel title={props.definition.title} />
			<div
				ref={scrollerRef}
				class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
				style={{ "padding-block": `${PLOT_PADDING_Y_PX}px` }}
				role="list"
			>
				<div
					ref={layerRef}
					class="group/plot relative"
					style={{
						"--label-fade-in": `${LABEL_FADE_IN_MS}ms`,
						height: `${props.layout.rows.length * ROW_HEIGHT}px`,
						"margin-left": "var(--timeline-plot-inset)",
						width: "var(--timeline-plot-width)",
					}}
				>
					<For each={visibleBars()}>
						{(bar) => {
							const appearance = appearanceOf(bar.span);
							const isError = isErrorSpan(bar.span);
							return (
								<SpanBar
									id={bar.id}
									name={appearance.name}
									startOffset={bar.startOffset}
									duration={bar.duration}
									row={bar.row}
									color={isError ? ERROR_SPAN_COLOR : appearance.color}
									isError={isError}
									isFocused={props.focusedSpanId === bar.id}
									events={appearance.events}
									icon={appearance.icon}
									onHover={props.onBarHover}
									matchedSpanIds={props.matchedSpanIds}
									hoveredSearchSpanId={props.hoveredSearchSpanId}
								/>
							);
						}}
					</For>
				</div>
			</div>
		</div>
	);
}
