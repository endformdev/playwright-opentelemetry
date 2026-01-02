import { For, Show, type JSX } from "solid-js";
import type { Span } from "../../trace-data-loader/exportToSpans";
import type { HoveredSpan } from "../getElementsAtTime";
import { formatAttributeValue, formatDuration } from "../formatters";

export interface SpanDetailsProps {
	hoveredSpan: HoveredSpan;
	testStartTimeMs: number;
	colorFn: (depth: number, span: Span) => string;
	isFocused: boolean;
	/** Optional icon to display in header */
	icon?: JSX.Element;
	/** Optional override for display title */
	displayTitle?: string;
}

export function SpanDetails(props: SpanDetailsProps) {
	const { span, depth } = props.hoveredSpan;
	const color = () => props.colorFn(depth, span);

	const formatAbsoluteTime = (offsetMs: number) => {
		const absoluteMs = props.testStartTimeMs + offsetMs;
		const absoluteDate = new Date(absoluteMs);
		const timeStr = absoluteDate.toLocaleTimeString("en-US", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		const msStr = String(absoluteMs % 1000).padStart(3, "0");
		return `${timeStr}.${msStr}`;
	};

	const endOffsetMs = () => span.startOffsetMs + span.durationMs;

	const timeRangeDisplay = () =>
		`${formatDuration(span.startOffsetMs)} → ${formatDuration(endOffsetMs())}`;

	const absoluteTimeTooltip = () =>
		`Start: ${formatAbsoluteTime(span.startOffsetMs)}\nEnd: ${formatAbsoluteTime(endOffsetMs())}`;

	const attributeEntries = () => {
		return Object.entries(span.attributes).filter(
			([key]) => key !== "test.step.title" && key !== "test.case.title",
		);
	};

	return (
		<div
			data-span-id={span.id}
			class="rounded-lg border-2 overflow-hidden transition-all duration-150"
			classList={{
				"ring-2 ring-blue-200": props.isFocused,
			}}
			style={{
				"margin-left": `${depth * 12}px`,
				"border-color": props.isFocused ? "#3b82f6" : color(),
			}}
		>
			{/* Header with span name and color indicator */}
			<div
				class="px-3 py-2 text-white text-sm font-medium flex items-center gap-2"
				style={{ "background-color": color() }}
			>
				{props.icon}
				<span class="truncate">{props.displayTitle ?? span.title}</span>
			</div>

			{/* Details */}
			<div class="bg-gray-50 px-3 py-2 space-y-2 text-xs">
				{/* Timing info - responsive single row that wraps on small widths */}
				<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
					<span>
						<span class="text-gray-500">Duration: </span>
						<span class="font-mono text-gray-900">
							{formatDuration(span.durationMs)}
						</span>
					</span>
					<span class="cursor-help" title={absoluteTimeTooltip()}>
						<span class="text-gray-500">Time: </span>
						<span class="font-mono text-gray-500">{timeRangeDisplay()}</span>
					</span>
				</div>

				{/* Other span info */}
				<div class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
					<span class="text-gray-500">Kind:</span>
					<span class="text-gray-900 capitalize">{span.kind}</span>

					<Show when={span.name !== span.title}>
						<span class="text-gray-500">Span Name:</span>
						<span class="font-mono text-gray-900">{span.name}</span>
					</Show>
				</div>

				{/* Attributes */}
				<Show when={attributeEntries().length > 0}>
					<div class="border-t border-gray-200 pt-2 mt-2">
						<div class="text-gray-500 mb-1">Attributes:</div>
						<div class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 pl-2">
							<For each={attributeEntries()}>
								{([key, value]) => (
									<>
										<span class="text-gray-500 truncate" title={key}>
											{key}:
										</span>
										<span
											class="font-mono text-gray-900 break-all"
											title={String(value)}
										>
											{formatAttributeValue(value)}
										</span>
									</>
								)}
							</For>
						</div>
					</div>
				</Show>
			</div>
		</div>
	);
}
