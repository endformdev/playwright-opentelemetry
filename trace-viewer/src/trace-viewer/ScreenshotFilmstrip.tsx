import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";

import type { ScreenshotInfo } from "~/trace-info-loader";

import {
	type Screenshot,
	type SlotScreenshot,
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

/** Selected screenshot for a slot - null means empty slot */
type SelectedSlot = SlotScreenshot<ScreenshotInfo>;

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
	// 1. Showing screenshots within the visible range (closest to slot center)
	// 2. When no screenshot in slot bounds, showing closest earlier screenshot
	// 3. When zoomed into an empty region, showing closest earlier screenshot repeated
	// 4. null entries for slots where no screenshot exists yet (respects causality)
	const selectedScreenshots = createMemo((): SelectedSlot[] => {
		const timeRange = viewportToTimeRange(props.viewport);
		const selected = selectScreenshots(
			screenshotsWithRelativeTime(),
			slotCount(),
			timeRange,
		);
		// Return the original ScreenshotInfo objects (or null for empty slots)
		return selected.map((s) => (s ? s.original : null));
	});

	// Check if we have any non-null slots to display
	const hasAnyScreenshots = createMemo(() =>
		selectedScreenshots().some((s) => s !== null),
	);

	return (
		<div
			ref={contentRef}
			class="h-full bg-gray-50 overflow-hidden p-2"
			data-testid="screenshot-filmstrip"
		>
			<div class="flex gap-2 h-full">
				<Show
					when={slotCount() > 0}
					fallback={
						<Show
							when={props.screenshots.length > 0}
							fallback={
								<div class="flex items-center justify-center w-full text-gray-400 text-sm">
									No screenshots available
								</div>
							}
						>
							<div class="flex items-center justify-center w-full text-gray-400 text-sm">
								Resize panel to view screenshots
							</div>
						</Show>
					}
				>
					<Show
						when={hasAnyScreenshots()}
						fallback={
							<div class="flex items-center justify-center w-full text-gray-400 text-sm">
								No screenshots in this time range
							</div>
						}
					>
						<For each={selectedScreenshots()}>
							{(screenshot) => (
								<Show
									when={screenshot}
									fallback={
										// Empty slot - takes up space but shows nothing
										<div class="flex-shrink-0 h-full aspect-video" />
									}
								>
									{(s) => (
										// biome-ignore lint/a11y/noStaticElementInteractions: hover tracking for scroll-to-screenshot feature
										<div
											class="flex-shrink-0 h-full aspect-video bg-white rounded border border-gray-200 overflow-hidden shadow-sm"
											onMouseEnter={() => props.onScreenshotHover?.(s().url)}
											onMouseLeave={() => props.onScreenshotHover?.(null)}
										>
											<img
												src={s().url}
												alt={`Screenshot at ${s().timestamp}`}
												class="w-full h-full object-contain select-none"
												loading="lazy"
												draggable={false}
												data-testid="screenshot-filmstrip-image"
											/>
										</div>
									)}
								</Show>
							)}
						</For>
					</Show>
				</Show>
			</div>
		</div>
	);
}
