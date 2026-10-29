import { createMemo, For } from "solid-js";
import { isErrorSpan, type Span } from "../../trace-data-loader/exportToSpans";
import { useViewportContext } from "../contexts/ViewportContext";
import type { PackedSpan, PackedSpansResult } from "../packSpans";
import { isTimeRangeVisible } from "../viewport";
import { PanelCornerLabel } from "./PanelHeader";
import { ROW_HEIGHT, SpanBar } from "./SpanBar";
import {
	getStepTimelineColor,
	NON_PLAYWRIGHT_STEP_COLOR,
} from "./stepSpanStyles";

export interface StepsTimelineProps {
	steps: Span[];
	/** Packed rows for `steps`, shared with keyboard navigation */
	layout: PackedSpansResult;
	focusedSpanId?: string | null;
	onStepHover?: (stepId: string | null) => void;
	matchedSpanIds?: Set<string>;
	hoveredSearchSpanId?: string | null;
}

function buildDepthMap(spans: Span[]): Map<string, number> {
	const depthMap = new Map<string, number>();
	const spanMap = new Map<string, Span>();

	// Build lookup map
	for (const span of spans) {
		spanMap.set(span.id, span);
	}

	// Calculate depth for each span
	const getDepth = (span: Span): number => {
		if (depthMap.has(span.id)) {
			return depthMap.get(span.id)!;
		}

		if (span.parentId === null) {
			depthMap.set(span.id, 0);
			return 0;
		}

		const parent = spanMap.get(span.parentId);
		if (!parent) {
			depthMap.set(span.id, 0);
			return 0;
		}

		const depth = getDepth(parent) + 1;
		depthMap.set(span.id, depth);
		return depth;
	};

	for (const span of spans) {
		getDepth(span);
	}

	return depthMap;
}

const ERROR_SPAN_COLOR = "#dc2626";

export function StepsTimeline(props: StepsTimelineProps) {
	const { viewport } = useViewportContext();

	const depthMap = createMemo(() => buildDepthMap(props.steps));
	const stepMap = createMemo(
		() => new Map(props.steps.map((span) => [span.id, span])),
	);
	const errorSpanIds = createMemo(
		() => new Set(props.steps.filter(isErrorSpan).map((span) => span.id)),
	);

	const visibleSteps = createMemo(() => {
		return props.layout.spans.filter((step) =>
			isTimeRangeVisible(
				step.startOffset,
				step.startOffset + step.duration,
				viewport(),
			),
		);
	});

	const containerHeight = () => props.layout.totalRows * ROW_HEIGHT;

	return (
		<div
			class="relative h-full flex flex-col bg-gray-50 overflow-hidden"
			role="region"
			aria-label="Steps Timeline"
		>
			<PanelCornerLabel title="Steps Timeline" />
			<div
				class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-3"
				role="list"
			>
				<div
					class="relative"
					style={{
						height: `${containerHeight()}px`,
						"margin-left": "var(--timeline-plot-inset)",
						width: "var(--timeline-plot-width)",
					}}
				>
					<For each={visibleSteps()}>
						{(step: PackedSpan) => {
							const depth = depthMap().get(step.id) ?? 0;
							const span = stepMap().get(step.id);
							const isError = errorSpanIds().has(step.id);
							return (
								<SpanBar
									id={step.id}
									name={step.name}
									startOffset={step.startOffset}
									duration={step.duration}
									row={step.row}
									color={
										isError
											? ERROR_SPAN_COLOR
											: span
												? getStepTimelineColor(span, depth)
												: NON_PLAYWRIGHT_STEP_COLOR
									}
									isError={isError}
									isFocused={props.focusedSpanId === step.id}
									onHover={props.onStepHover}
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
