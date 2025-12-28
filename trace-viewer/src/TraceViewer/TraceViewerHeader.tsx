import { Show, type Accessor } from "solid-js";
import type { TestInfo } from "../traceInfoLoader";

export interface TraceViewerHeaderProps {
	testInfo: TestInfo;
	hoverTimeMs: Accessor<number | null>;
}

export function TraceViewerHeader(props: TraceViewerHeaderProps) {
	const { testInfo } = props;

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

	return (
		<div class="flex-shrink-0 border-b border-gray-200 bg-white px-4 py-3">
			<div class="flex items-center gap-4">
				{/* Status Icon */}
				<span class={`text-xl ${statusColor()}`}>{statusIcon()}</span>

				{/* Test Name and Info */}
				<div class="flex-1 min-w-0">
					<div class="flex items-baseline gap-2">
						{testInfo.describes.length > 0 && (
							<span class="text-gray-500 text-sm truncate">
								{testInfo.describes.join(" › ")}{" "}
								<span class="text-gray-400">›</span>
							</span>
						)}
						<span class="font-semibold text-gray-900 truncate">
							{testInfo.name}
						</span>
					</div>
					<div class="flex items-center gap-3 text-xs text-gray-500">
						<span class="font-mono truncate">
							{testInfo.file}:{testInfo.line}
						</span>
						<span class="text-gray-300">|</span>
						<span class="font-mono">{duration()}ms</span>
						<span class={statusColor()}>{testInfo.status}</span>
					</div>
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
		</div>
	);
}
