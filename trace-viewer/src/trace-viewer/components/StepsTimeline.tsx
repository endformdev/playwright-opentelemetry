import { createMemo, For } from "solid-js";
import type { Span } from "../../trace-data-loader/exportToSpans";
import { useViewportContext } from "../contexts/ViewportContext";
import { type PackedSpan, packSpans, type SpanInput } from "../packSpans";
import { isTimeRangeVisible } from "../viewport";
import { ROW_HEIGHT, SpanBar } from "./SpanBar";

export interface StepsTimelineProps {
	steps: Span[];
	onStepHover?: (stepId: string | null) => void;
	matchedSpanIds?: Set<string>;
	hoveredSearchSpanId?: string | null;
}

function spansToSpanInput(spans: Span[]): SpanInput[] {
	return spans.map((span) => ({
		id: span.id,
		name: span.title,
		startOffset: span.startOffsetMs,
		duration: span.durationMs,
		parentId: span.parentId,
	}));
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

function getStepColor(depth: number): string {
	return `hsl(${210 + depth * 30}, 70%, ${55 + depth * 5}%)`;
}

export function StepsTimeline(props: StepsTimelineProps) {
	const { viewport } = useViewportContext();

	const packedStepsResult = createMemo(() => {
		const spanInputs = spansToSpanInput(props.steps);
		return packSpans(spanInputs);
	});

	const depthMap = createMemo(() => buildDepthMap(props.steps));

	const visibleSteps = createMemo(() => {
		return packedStepsResult().spans.filter((step) =>
			isTimeRangeVisible(
				step.startOffset,
				step.startOffset + step.duration,
				viewport(),
			),
		);
	});

	const containerHeight = () => packedStepsResult().totalRows * ROW_HEIGHT;

	return (
		<div class="h-full flex flex-col bg-gray-50 overflow-hidden">
			<div class="flex-shrink-0 px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
				Steps Timeline
			</div>
			<div class="flex-1 overflow-y-auto overflow-x-hidden p-3">
				<div class="relative" style={{ height: `${containerHeight()}px` }}>
					<For each={visibleSteps()}>
						{(step: PackedSpan) => {
							const depth = depthMap().get(step.id) ?? 0;
							return (
								<SpanBar
									id={step.id}
									name={step.name}
									startOffset={step.startOffset}
									duration={step.duration}
									row={step.row}
									color={getStepColor(depth)}
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
