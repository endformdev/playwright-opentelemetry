import type { TestInfo } from "../traceInfoLoader";

export interface TraceViewerHeaderProps {
	testInfo: TestInfo;
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

	return (
		<div class="flex-shrink-0 border-b border-gray-200 bg-white px-4 py-3">
			<div class="flex items-center gap-4">
				{/* Status Icon */}
				<span class={`text-xl ${statusColor()}`}>{statusIcon()}</span>

				{/* Test Name */}
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
					<div class="text-xs text-gray-500 font-mono truncate">
						{testInfo.file}:{testInfo.line}
					</div>
				</div>

				{/* Duration */}
				<div class="flex-shrink-0 text-right">
					<div class="text-sm font-mono text-gray-700">{duration()}ms</div>
					<div class={`text-xs ${statusColor()}`}>{testInfo.status}</div>
				</div>
			</div>
		</div>
	);
}
