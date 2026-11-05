import {
	CircleCheck,
	CircleX,
	Minus,
	Timer,
	TriangleAlert,
} from "lucide-solid";
import { type Accessor, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { Span } from "../trace-data-loader/exportToSpans";
import type { TestInfo, TestStatus } from "../trace-info-loader";
import { ErrorSpansDropdown } from "./components/ErrorSpansDropdown";
import { SearchCombobox } from "./components/SearchCombobox";
import {
	SettingsMenu,
	type SettingsMenuProps,
} from "./components/SettingsMenu";
import { useSearch } from "./contexts/SearchContext";
import type { SpanSelectionPlacement } from "./spanSelection";
import type { SetViewerSetting, ViewerSettings } from "./viewerSettings";

export interface TraceViewerHeaderProps {
	testInfo: TestInfo;
	errorSpans: Span[];
	hoverTimeMs: Accessor<number | null>;
	onSpanSelect?: (spanId: string, placement: SpanSelectionPlacement) => void;
	onSpanHover?: (spanId: string | null) => void;
	settings: ViewerSettings;
	onSettingChange: SetViewerSetting;
	emptySections: SettingsMenuProps["emptySections"];
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
				<StatusPill status={testInfo.status} />

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
								<div
									class="text-sm font-mono text-gray-900"
									data-testid="header-time"
								>
									{Math.round(time())}ms
								</div>
								<div class="text-xs font-mono text-gray-400">
									{formatAbsoluteTime(time())}
								</div>
							</div>
						)}
					</Show>
				</div>

				<SettingsMenu
					settings={props.settings}
					onSettingChange={props.onSettingChange}
					emptySections={props.emptySections}
				/>
			</div>
		</header>
	);
}

const STATUS_PILLS: Record<
	TestStatus,
	{ class: string; icon: typeof CircleX }
> = {
	passed: { class: "bg-emerald-50 text-emerald-700", icon: CircleCheck },
	failed: { class: "bg-red-50 text-red-700", icon: CircleX },
	timedOut: { class: "bg-red-50 text-red-700", icon: Timer },
	interrupted: { class: "bg-amber-50 text-amber-700", icon: TriangleAlert },
	skipped: { class: "bg-gray-100 text-gray-600", icon: Minus },
};

function StatusPill(props: { status: TestStatus }) {
	return (
		<span
			class={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-medium whitespace-nowrap ${STATUS_PILLS[props.status].class}`}
			data-testid="test-status"
		>
			<Dynamic
				component={STATUS_PILLS[props.status].icon}
				size={14}
				aria-hidden="true"
			/>
			{props.status}
		</span>
	);
}
