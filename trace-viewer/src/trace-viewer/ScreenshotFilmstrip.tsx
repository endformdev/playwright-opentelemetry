import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
} from "solid-js";

import type { ScreenshotInfo } from "~/trace-info-loader";

import {
	type Screenshot,
	selectScreenshots,
	viewportToTimeRange,
} from "./selectScreenshots";
import type { TimelineViewport } from "./viewport";

export interface ScreenshotFilmstripProps {
	screenshots: ScreenshotInfo[];
	/** Current viewport state for selecting screenshots */
	viewport: TimelineViewport;
	/** Test start time in milliseconds (Unix timestamp) for converting absolute to relative timestamps */
	testStartTimeMs: number;
	/** Callback when hovering over a screenshot (url) or null when leaving */
	onScreenshotHover?: (screenshotUrl: string | null) => void;
}

/** Screenshot with relative timestamp for selection, keeping original data */
interface RelativeScreenshot extends Screenshot {
	original: ScreenshotInfo;
}

export function ScreenshotFilmstrip(props: ScreenshotFilmstripProps) {
	let contentRef: HTMLDivElement | undefined;

	const [slotCount, setSlotCount] = createSignal(0);

	// Convert screenshots to relative timestamps (offset from test start)
	const screenshotsWithRelativeTime = createMemo((): RelativeScreenshot[] => {
		return props.screenshots.map((screenshot) => ({
			timestamp: screenshot.timestamp - props.testStartTimeMs,
			original: screenshot,
		}));
	});

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
					setSlotCount(Math.max(0, count));
				}
			}
		});

		resizeObserver.observe(contentRef);

		onCleanup(() => {
			resizeObserver.disconnect();
		});
	});

	// Select screenshots based on viewport - this handles:
	// 1. Showing screenshots within the visible range
	// 2. When zoomed into an empty region, showing closest screenshots
	const selectedScreenshots = createMemo(() => {
		const timeRange = viewportToTimeRange(props.viewport);
		const selected = selectScreenshots(
			screenshotsWithRelativeTime(),
			slotCount(),
			timeRange,
		);
		// Return the original ScreenshotInfo objects
		return selected.map((s) => s.original);
	});

	return (
		<div ref={contentRef} class="h-full bg-gray-50 overflow-hidden p-2">
			<div class="flex gap-2 h-full">
				{selectedScreenshots().length > 0 ? (
					<For each={selectedScreenshots()}>
						{(screenshot) => (
							// biome-ignore lint/a11y/noStaticElementInteractions: hover tracking for scroll-to-screenshot feature
							<div
								class="flex-shrink-0 h-full aspect-video bg-white rounded border border-gray-200 overflow-hidden shadow-sm"
								onMouseEnter={() => props.onScreenshotHover?.(screenshot.url)}
								onMouseLeave={() => props.onScreenshotHover?.(null)}
							>
								<img
									src={screenshot.url}
									alt={`Screenshot at ${screenshot.timestamp}`}
									class="w-full h-full object-contain"
									loading="lazy"
								/>
							</div>
						)}
					</For>
				) : props.screenshots.length === 0 ? (
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
	);
}
