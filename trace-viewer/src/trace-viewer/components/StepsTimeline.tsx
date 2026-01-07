import { createMemo, For, type JSX } from "solid-js";
import type { Span } from "../../trace-data-loader/exportToSpans";
import { useViewportContext } from "../contexts/ViewportContext";
import {
	generateConnectors,
	type PackedSpan,
	packSpans,
	type SpanConnector,
	type SpanInput,
} from "../packSpans";
import { isTimeRangeVisible, timeToViewportPosition } from "../viewport";

const ROW_HEIGHT = 28;

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

export function StepsTimeline(props: StepsTimelineProps) {
	const { viewport, durationMs } = useViewportContext();

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

	const visibleConnectors = createMemo(() => {
		const visibleIds = new Set(visibleSteps().map((s) => s.id));
		return generateConnectors(packedStepsResult().spans, durationMs()).filter(
			(c) => visibleIds.has(c.parentId) || visibleIds.has(c.childId),
		);
	});

	const renderStep = (step: PackedSpan): JSX.Element => {
		const leftPercent = () =>
			timeToViewportPosition(step.startOffset, viewport()) * 100;
		const rightPercent = () =>
			timeToViewportPosition(step.startOffset + step.duration, viewport()) *
			100;
		const widthPercent = () => rightPercent() - leftPercent();
		const depth = depthMap().get(step.id) ?? 0;

		// Make shouldHighlight a function to ensure reactivity
		const shouldHighlight = () => {
			// If hovering a specific search result, only highlight that one
			// Otherwise, highlight all matched spans
			return props.hoveredSearchSpanId
				? step.id === props.hoveredSearchSpanId
				: props.matchedSpanIds?.has(step.id);
		};

		const displayText = () => {
			if (widthPercent() > 2) {
				return step.name;
			}
			return null;
		};

		return (
			<div
				class="absolute h-6 rounded text-xs flex items-center px-2 text-white truncate cursor-pointer hover:brightness-95 select-none"
				classList={{
					"ring-2 ring-yellow-400 ring-offset-1": shouldHighlight(),
				}}
				style={{
					left: `${leftPercent()}%`,
					width: `${Math.max(widthPercent(), 1)}%`,
					top: `${step.row * ROW_HEIGHT}px`,
					"background-color": `hsl(${210 + depth * 30}, 70%, ${55 + depth * 5}%)`,
				}}
				title={`${step.name} (${step.duration}ms)`}
				onMouseEnter={() => props.onStepHover?.(step.id)}
				onMouseLeave={() => props.onStepHover?.(null)}
			>
				{displayText()}
			</div>
		);
	};

	const renderConnector = (connector: SpanConnector): JSX.Element => {
		const rowDiff = connector.childRow - connector.parentRow;
		const topPx = connector.parentRow * ROW_HEIGHT + 24;
		const heightPx = (rowDiff - 1) * ROW_HEIGHT + 4;

		// Use reactive getter so position updates when viewport changes
		const xPercent = () => {
			const xPositionMs = (connector.xPercent / 100) * durationMs();
			return timeToViewportPosition(xPositionMs, viewport()) * 100;
		};

		return (
			<div
				class="absolute w-px bg-gray-400"
				style={{
					left: `${xPercent()}%`,
					top: `${topPx}px`,
					height: `${heightPx}px`,
				}}
			/>
		);
	};

	const containerHeight = () => packedStepsResult().totalRows * ROW_HEIGHT;

	return (
		<div class="h-full flex flex-col bg-gray-50 overflow-hidden">
			<div class="flex-shrink-0 px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
				Steps Timeline
			</div>
			<div class="flex-1 overflow-y-auto overflow-x-hidden p-3">
				<div class="relative" style={{ height: `${containerHeight()}px` }}>
					{/* Render connector lines first (behind spans) */}
					<For each={visibleConnectors()}>
						{(connector) => renderConnector(connector)}
					</For>
					{/* Render steps on top */}
					<For each={visibleSteps()}>{(step) => renderStep(step)}</For>
				</div>
			</div>
		</div>
	);
}
