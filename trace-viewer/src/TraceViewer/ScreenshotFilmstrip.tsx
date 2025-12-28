import { createEffect, createSignal, For, onCleanup } from "solid-js";

import type { ScreenshotInfo } from "~/traceInfoLoader";

import { selectScreenshots } from "./selectScreenshots";

export interface ScreenshotFilmstripProps {
	screenshots: ScreenshotInfo[];
}

export function ScreenshotFilmstrip(props: ScreenshotFilmstripProps) {
	const { screenshots } = props;

	let contentRef: HTMLDivElement | undefined;

	// Selected screenshots based on available space
	const [selectedScreenshots, setSelectedScreenshots] = createSignal<
		ScreenshotInfo[]
	>([]);

	// Set up ResizeObserver to track content area size
	createEffect(() => {
		if (!contentRef) return;

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const height = entry.contentRect.height;
				const width = entry.contentRect.width;

				// Recalculate how many screenshots fit
				if (height > 0 && width > 0) {
					const availableHeight = height - 16; // padding
					const screenshotHeight = availableHeight;
					const screenshotWidth = screenshotHeight * (16 / 9);
					const gap = 8;

					const count = Math.floor((width + gap) / (screenshotWidth + gap));
					const fitCount = Math.max(0, count);

					// Select evenly distributed screenshots
					const selected = selectScreenshots(screenshots, fitCount);
					setSelectedScreenshots(selected);
				}
			}
		});

		resizeObserver.observe(contentRef);

		onCleanup(() => {
			resizeObserver.disconnect();
		});
	});

	return (
		<div class="h-full flex flex-col bg-gray-50">
			<div class="flex-shrink-0 px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
				Screenshots ({selectedScreenshots().length} of {screenshots.length})
			</div>
			<div ref={contentRef} class="flex-1 overflow-hidden p-2">
				<div class="flex gap-2 h-full">
					{selectedScreenshots().length > 0 ? (
						<For each={selectedScreenshots()}>
							{(screenshot) => (
								<div class="flex-shrink-0 h-full aspect-video bg-white rounded border border-gray-200 overflow-hidden shadow-sm">
									<img
										src={screenshot.url}
										alt={`Screenshot at ${screenshot.timestamp}`}
										class="w-full h-full object-contain"
										loading="lazy"
									/>
								</div>
							)}
						</For>
					) : screenshots.length === 0 ? (
						<div class="flex items-center justify-center w-full text-gray-400 text-sm">
							No screenshots available
						</div>
					) : (
						<div class="flex items-center justify-center w-full text-gray-400 text-sm">
							Resize panel to view screenshots
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
