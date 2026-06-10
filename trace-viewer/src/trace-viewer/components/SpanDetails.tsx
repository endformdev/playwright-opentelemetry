import { ArrowUpFromDot } from "lucide-solid";
import { For, type JSX, Show } from "solid-js";
import {
	isErrorSpan,
	type Span,
	type SpanEvent,
} from "../../trace-data-loader/exportToSpans";
import { formatAttributeValue, formatDuration } from "../formatters";
import type { HoveredSpan } from "../getElementsAtTime";
import { getSpanEventSeverity } from "./spanEventStyles";

export interface SpanDetailsProps {
	hoveredSpan: HoveredSpan;
	testStartTimeMs: number;
	colorFn: (depth: number, span: Span) => string;
	isFocused: boolean;
	/** Optional icon to display in header */
	icon?: JSX.Element;
	/** Optional override for display title */
	displayTitle?: string;
	/** Callback to navigate to a span without changing time position */
	onNavigateToSpan?: (spanId: string) => void;
}

export function SpanDetails(props: SpanDetailsProps) {
	const { span, depth, parent } = props.hoveredSpan;
	const color = () =>
		isErrorSpan(span) ? "#dc2626" : props.colorFn(depth, span);
	const parentColor = () =>
		parent ? props.colorFn(parent.depth, parent.span) : "";

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

	const statusLabel = () => (isErrorSpan(span) ? "Error" : "OK");
	const eventAbsoluteOffsetMs = (event: SpanEvent) =>
		span.startOffsetMs + event.timeOffsetMs;

	const handleParentClick = () => {
		if (parent && props.onNavigateToSpan) {
			props.onNavigateToSpan(parent.span.id);
		}
	};

	return (
		<div
			data-span-id={span.id}
			class="rounded-md border-2 overflow-hidden transition-all duration-150"
			classList={{
				"ring-2 ring-blue-200": props.isFocused,
			}}
			style={{
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
				<Show when={isErrorSpan(span)}>
					<div class="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-red-800">
						<div class="font-semibold">Error</div>
						<Show when={span.status?.message}>
							{(message) => (
								<div
									class="mt-0.5 whitespace-pre-wrap break-words font-mono"
									data-testid="span-error-message"
								>
									{message()}
								</div>
							)}
						</Show>
					</div>
				</Show>

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
				<div class="flex flex-wrap items-start gap-x-4 gap-y-2">
					{/* Kind field */}
					<div class="flex gap-x-3 items-baseline">
						<span class="text-gray-500">Kind:</span>
						<span class="text-gray-900 capitalize">{span.kind}</span>
					</div>

					<div class="flex gap-x-3 items-baseline">
						<span class="text-gray-500">Status:</span>
						<span
							class="capitalize"
							classList={{
								"text-red-700 font-semibold": isErrorSpan(span),
								"text-gray-900": !isErrorSpan(span),
							}}
						>
							{statusLabel()}
						</span>
					</div>

					{/* Parent navigation chip - shows on right side when space allows, wraps below otherwise */}
					<Show when={parent}>
						<div class="flex items-center gap-1.5 ml-auto">
							<span class="text-gray-500">Parent:</span>
							<button
								type="button"
								data-parent-span-id={parent!.span.id}
								onClick={handleParentClick}
								class="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-opacity hover:opacity-80"
								style={{ "background-color": parentColor(), color: "white" }}
								title={`Go to parent: ${parent!.span.title}`}
							>
								<ArrowUpFromDot size={12} />
								<span class="truncate max-w-[150px]">{parent!.span.title}</span>
							</button>
						</div>
					</Show>
				</div>

				{/* Span Name - separate section if different from title */}
				<Show when={span.name !== span.title}>
					<div class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
						<span class="text-gray-500">Span Name:</span>
						<span class="font-mono text-gray-900">{span.name}</span>
					</div>
				</Show>

				{/* Attributes */}
				<Show when={(span.events ?? []).length > 0}>
					<div class="border-t border-gray-200 pt-2 mt-2">
						<div class="text-gray-500 mb-1">Events:</div>
						<div class="space-y-2 pl-2">
							<For each={span.events ?? []}>
								{(event, index) => (
									<div
										data-testid="span-event-card"
										data-span-event-name={event.name}
										data-span-event-index={index()}
										data-span-event-error={
											getSpanEventSeverity(event) === "error"
												? "true"
												: undefined
										}
										class="rounded border px-2 py-1.5"
										classList={{
											"border-red-200 bg-red-50":
												getSpanEventSeverity(event) === "error",
											"border-amber-200 bg-amber-50":
												getSpanEventSeverity(event) === "warning",
											"border-gray-200 bg-white":
												getSpanEventSeverity(event) === "default",
										}}
									>
										<div class="flex items-baseline justify-between gap-2">
											<div class="font-semibold text-gray-800">
												{event.name}
											</div>
											<div class="font-mono text-gray-500">
												{formatDuration(eventAbsoluteOffsetMs(event))}
											</div>
										</div>
										<Show when={eventMessage(event)}>
											{(message) => (
												<div class="mt-1 whitespace-pre-wrap break-words font-mono text-gray-900">
													{message()}
												</div>
											)}
										</Show>
										<Show when={eventAttributeEntries(event).length > 0}>
											<div class="mt-1 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
												<For each={eventAttributeEntries(event)}>
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
										</Show>
									</div>
								)}
							</For>
						</div>
					</div>
				</Show>

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

function eventMessage(event: SpanEvent): string | undefined {
	const message =
		event.attributes["exception.message"] ?? event.attributes.message;
	return typeof message === "string" && message.length > 0
		? message
		: undefined;
}

function eventAttributeEntries(event: SpanEvent) {
	return Object.entries(event.attributes).filter(
		([key]) => key !== "exception.message" && key !== "message",
	);
}
