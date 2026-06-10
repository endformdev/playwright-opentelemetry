import { type Accessor, Show } from "solid-js";
import type { Span } from "../trace-data-loader/exportToSpans";
import type { TestInfo } from "../trace-info-loader";
import { ErrorSpansDropdown } from "./components/ErrorSpansDropdown";
import { SearchCombobox } from "./components/SearchCombobox";
import { useSearch } from "./contexts/SearchContext";
import type { SpanSelectionPlacement } from "./spanSelection";

export interface TraceViewerHeaderProps {
	testInfo: TestInfo;
	errorSpans: Span[];
	hoverTimeMs: Accessor<number | null>;
	onSpanSelect?: (spanId: string, placement: SpanSelectionPlacement) => void;
	onSpanHover?: (spanId: string | null) => void;
}

export function TraceViewerHeader(props: TraceViewerHeaderProps) {
	const { testInfo } = props;
	const search = useSearch();

	const duration = () => {
		const startNano = BigInt(testInfo.startTimeUnixNano);
		const endNano = BigInt(testInfo.endTimeUnixNano);
		const durationMs = Number((endNano - startNano) / BigInt(1_000_000));
		return durationMs;
	};

	const statusColor = () => {
		switch (testInfo.status) {
			case "passed":
				return "text-green-600";
			case "failed":
				return "text-red-600";
			case "skipped":
				return "text-yellow-600";
			case "timedOut":
				return "text-orange-600";
			case "interrupted":
				return "text-orange-600";
			default:
				return "text-gray-500";
		}
	};

	const statusIcon = () => {
		switch (testInfo.status) {
			case "passed":
				return "✓";
			case "failed":
				return "✗";
			case "skipped":
				return "○";
			case "timedOut":
				return "⏱";
			case "interrupted":
				return "⚠";
			default:
				return "?";
		}
	};

	// Get test start time as a Date
	const testStartTime = () => {
		const startNano = BigInt(testInfo.startTimeUnixNano);
		const startMs = Number(startNano / BigInt(1_000_000));
		return new Date(startMs);
	};

	// Format the absolute timestamp for hover position
	const formatAbsoluteTime = (offsetMs: number) => {
		const absoluteTime = new Date(testStartTime().getTime() + offsetMs);
		const date = absoluteTime.toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		});
		const time = absoluteTime.toLocaleTimeString(undefined, {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});
		const ms = absoluteTime.getMilliseconds().toString().padStart(3, "0");
		return `${date}, ${time}.${ms}`;
	};

	const handleResultSelect = (spanId: string) => {
		props.onSpanSelect?.(spanId, "start");
	};

	const handleErrorSpanSelect = (spanId: string) => {
		props.onSpanSelect?.(spanId, "end");
	};

	return (
		<header
			class="flex-shrink-0 border-b border-gray-200 bg-white px-4 py-3"
			data-testid="trace-viewer-header"
		>
			<div class="flex items-center gap-4">
				{/* Status Icon */}
				<span class={`text-xl ${statusColor()}`}>{statusIcon()}</span>

				{/* Test Name and Info */}
				<div class="flex-1 min-w-0">
					<div class="flex items-baseline gap-2">
						{testInfo.describes.length > 0 && (
							<span
								class="text-gray-500 text-sm truncate"
								data-testid="test-describes"
							>
								{testInfo.describes.join(" › ")}{" "}
								<span class="text-gray-400">›</span>
							</span>
						)}
						<span
							class="font-semibold text-gray-900 truncate"
							data-testid="test-name"
						>
							{testInfo.name}
						</span>
					</div>
					<div class="flex items-center gap-3 text-xs text-gray-500">
						<span class="font-mono truncate" data-testid="test-file-location">
							{testInfo.file}:{testInfo.line}
						</span>
						<span class="text-gray-300">|</span>
						<span class="font-mono">{duration()}ms</span>
						<span class={statusColor()} data-testid="test-status">
							{testInfo.status}
						</span>
					</div>
				</div>

				<ErrorSpansDropdown
					spans={props.errorSpans}
					onSpanSelect={handleErrorSpanSelect}
					onSpanHover={props.onSpanHover}
				/>

				{/* Search */}
				<div class="w-80">
					<SearchCombobox
						results={search.results()}
						query={search.query()}
						onQueryChange={search.setQuery}
						onClear={search.clearSearch}
						onResultSelect={handleResultSelect}
						onResultHover={props.onSpanHover}
					/>
				</div>

				{/* Hover Time Display */}
				<div class="flex-shrink-0 text-right min-w-[140px]">
					<Show
						when={props.hoverTimeMs()}
						fallback={
							<div>
								<div class="text-sm font-mono text-gray-300">--</div>
								<div class="text-xs font-mono text-gray-200">--</div>
							</div>
						}
					>
						{(time) => (
							<div>
								<div class="text-sm font-mono text-blue-600">
									{Math.round(time())}ms
								</div>
								<div class="text-xs font-mono text-gray-400">
									{formatAbsoluteTime(time())}
								</div>
							</div>
						)}
					</Show>
				</div>
			</div>
		</header>
	);
}
