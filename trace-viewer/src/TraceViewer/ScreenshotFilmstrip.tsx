import { For } from "solid-js";
import type { ScreenshotInfo } from "~/traceInfoLoader";

export interface ScreenshotFilmstripProps {
	screenshots: ScreenshotInfo[];
}

export function ScreenshotFilmstrip(props: ScreenshotFilmstripProps) {
	const { screenshots } = props;

	return (
		<div class="h-full flex flex-col bg-gray-50">
			<div class="flex-shrink-0 px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
				Screenshots ({screenshots.length})
			</div>
			<div class="flex-1 overflow-x-auto overflow-y-hidden p-2">
				<div class="flex gap-2 h-full">
					{screenshots.length > 0 ? (
						<For each={screenshots}>
							{(screenshot) => (
								<div class="flex-shrink-0 h-full aspect-video bg-white rounded border border-gray-200 overflow-hidden shadow-sm">
									<img
										src={screenshot.url}
										alt={`Screenshot at ${screenshot.timestamp}`}
										class="w-full h-full object-contain"
									/>
								</div>
							)}
						</For>
					) : (
						<div class="flex items-center justify-center w-full text-gray-400 text-sm">
							No screenshots available
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
