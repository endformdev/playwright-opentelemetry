import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	type Resource,
	Show,
} from "solid-js";

import type { ScreenshotInfo } from "../trace-info-loader";

import {
	type Screenshot,
	type SlotScreenshot,
	selectScreenshots,
	viewportToTimeRange,
} from "./selectScreenshots";
import type { TimelineViewport } from "./viewport";

export interface ScreenshotFilmstripProps {
	screenshots: Resource<ScreenshotInfo[]>;
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

interface ScreenshotRow {
	contextId: string;
	pageIds: string[];
	screenshots: ScreenshotInfo[];
}

interface SelectedScreenshotRow extends ScreenshotRow {
	selectedScreenshots: SelectedSlot[];
}

const ROW_GAP_PX = 8;
const MAX_VISIBLE_ROWS = 3;

export function ScreenshotFilmstrip(props: ScreenshotFilmstripProps) {
	let contentRef: HTMLDivElement | undefined;

	const [slotCount, setSlotCount] = createSignal(0);
	const screenshots = () => props.screenshots() ?? [];
	const screenshotRows = createMemo(() =>
		groupScreenshotsByContext(screenshots()),
	);
	const visibleRowCount = createMemo(() =>
		Math.min(Math.max(1, screenshotRows().length), MAX_VISIBLE_ROWS),
	);
	const rowHeight = createMemo(
		() =>
			`calc((100% - ${(visibleRowCount() - 1) * ROW_GAP_PX}px) / ${visibleRowCount()})`,
	);

	// Convert screenshots to relative timestamps (offset from test start)
	const screenshotsWithRelativeTime = createMemo((): RelativeScreenshot[] => {
		return screenshots().map((screenshot) => ({
			timestamp: screenshot.timestamp - props.testStartTimeMs,
			original: screenshot,
		}));
	});

	const skeletonSlots = createMemo(() =>
		Array.from({ length: Math.max(1, slotCount()) }),
	);

	// Set up ResizeObserver to track content area size
	createEffect(() => {
		if (!contentRef) return;

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const height = entry.contentRect.height;
				const width = entry.contentRect.width;

				// Recalculate how many screenshots fit
				if (height > 0 && width > 0) {
					const rowCount = visibleRowCount();
					const availableHeight = height - 16 - ROW_GAP_PX * (rowCount - 1); // padding and visible row gaps
					const screenshotHeight = availableHeight / rowCount;
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
	const selectedScreenshotRows = createMemo((): SelectedScreenshotRow[] => {
		const timeRange = viewportToTimeRange(props.viewport);
		return screenshotRows().map((row) => {
			const rowScreenshots = screenshotsWithRelativeTime().filter(
				(screenshot) => screenshot.original.contextId === row.contextId,
			);
			const selected = selectScreenshots(
				rowScreenshots,
				slotCount(),
				timeRange,
			);
			return {
				...row,
				selectedScreenshots: selected.map((s) => (s ? s.original : null)),
			};
		});
	});

	// Check if we have any non-null slots to display
	const hasAnyScreenshots = createMemo(() =>
		selectedScreenshotRows().some((row) =>
			row.selectedScreenshots.some((s) => s !== null),
		),
	);

	return (
		<div
			ref={contentRef}
			class="h-full bg-gray-50 overflow-y-auto overflow-x-hidden p-2"
			role="region"
			aria-label="Screenshots"
		>
			<div class="flex flex-col gap-2 h-full">
				<Show when={props.screenshots.loading && screenshots().length === 0}>
					<Show
						when={slotCount() > 0}
						fallback={
							<div class="flex items-center justify-center w-full text-gray-400 text-sm">
								Loading screenshots...
							</div>
						}
					>
						<div class="flex gap-2 h-full">
							<For each={skeletonSlots()}>
								{() => (
									<div class="flex-shrink-0 h-full aspect-video bg-white rounded border border-gray-200 overflow-hidden shadow-sm">
										<div class="h-full w-full animate-pulse bg-gradient-to-br from-gray-100 via-gray-200 to-gray-100" />
									</div>
								)}
							</For>
						</div>
					</Show>
				</Show>
				<Show when={!props.screenshots.loading || screenshots().length > 0}>
					<Show
						when={slotCount() > 0}
						fallback={
							<Show
								when={screenshots().length > 0}
								fallback={
									<div class="flex items-center justify-center w-full text-gray-400 text-sm">
										{props.screenshots.error
											? "Failed to load screenshots"
											: "No screenshots available"}
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
							<For each={selectedScreenshotRows()}>
								{(row, rowIndex) => (
									<div
										class="flex gap-2 flex-shrink-0 min-h-0"
										style={{ height: rowHeight() }}
										data-testid="screenshot-row"
										data-screenshot-row-index={rowIndex()}
										data-screenshot-context-id={row.contextId}
										data-screenshot-page-ids={row.pageIds.join(",")}
										data-screenshot-source-count={row.screenshots.length}
									>
										<For each={row.selectedScreenshots}>
											{(screenshot) => (
												<Show
													when={screenshot}
													fallback={
														// Empty slot - takes up space but shows nothing
														<div class="flex-shrink-0 h-full aspect-video" />
													}
												>
													{(s) => (
														<div
															class="flex-shrink-0 h-full aspect-video bg-white rounded border border-gray-200 overflow-hidden shadow-sm"
															data-screenshot-timestamp={s().timestamp}
															data-screenshot-context-id={s().contextId}
															data-screenshot-page-id={s().pageId}
															onMouseEnter={() =>
																props.onScreenshotHover?.(s().url)
															}
															onMouseLeave={() =>
																props.onScreenshotHover?.(null)
															}
														>
															<img
																src={s().url}
																alt={`Screenshot at ${s().timestamp}`}
																class="w-full h-full object-contain select-none"
																loading="lazy"
																draggable={false}
															/>
														</div>
													)}
												</Show>
											)}
										</For>
									</div>
								)}
							</For>
						</Show>
					</Show>
				</Show>
			</div>
		</div>
	);
}

function groupScreenshotsByContext(
	screenshots: ScreenshotInfo[],
): ScreenshotRow[] {
	const rows = new Map<string, ScreenshotRow>();
	for (const screenshot of screenshots) {
		const row = rows.get(screenshot.contextId) ?? {
			contextId: screenshot.contextId,
			pageIds: [],
			screenshots: [],
		};
		if (!row.pageIds.includes(screenshot.pageId)) {
			row.pageIds.push(screenshot.pageId);
		}
		row.screenshots.push(screenshot);
		rows.set(screenshot.contextId, row);
	}

	return Array.from(rows.values()).map((row) => ({
		...row,
		pageIds: row.pageIds.sort(),
		screenshots: row.screenshots.sort((a, b) => a.timestamp - b.timestamp),
	}));
}
