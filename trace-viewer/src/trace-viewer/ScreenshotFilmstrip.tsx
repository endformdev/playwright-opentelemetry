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
	id: string;
	contextId: string;
	pageIds: string[];
	screenshots: ScreenshotInfo[];
}

interface SelectedScreenshotRow extends ScreenshotRow {
	selectedScreenshots: SelectedSlot[];
}

const ROW_GAP_PX = 8;
const PANEL_PADDING_Y_PX = 16;
const SCREENSHOT_ASPECT_RATIO = 16 / 9;

export function ScreenshotFilmstrip(props: ScreenshotFilmstripProps) {
	let contentRef: HTMLDivElement | undefined;

	const [slotCount, setSlotCount] = createSignal(0);
	const [contentSize, setContentSize] = createSignal<{
		width: number;
		height: number;
	} | null>(null);
	const [defaultRowHeightPx, setDefaultRowHeightPx] = createSignal<
		number | undefined
	>();
	const [defaultSingleRowPanelHeightPx, setDefaultSingleRowPanelHeightPx] =
		createSignal<number | undefined>();
	const [defaultMeasurementPending, setDefaultMeasurementPending] =
		createSignal(true);
	const [rowHeightPx, setRowHeightPx] = createSignal(0);
	const screenshots = () => props.screenshots() ?? [];
	const screenshotRows = createMemo(() =>
		groupScreenshotsByPage(screenshots()),
	);
	const screenshotRowsKey = createMemo(() =>
		screenshotRows()
			.map((row) => row.id)
			.join("|"),
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

	createEffect(() => {
		screenshotRowsKey();
		setDefaultRowHeightPx(undefined);
		setDefaultSingleRowPanelHeightPx(undefined);
		setDefaultMeasurementPending(true);

		const frameId = requestAnimationFrame(() => {
			if (contentRef) {
				const rect = contentRef.getBoundingClientRect();
				setContentSize({ width: rect.width, height: rect.height });
			}
			setDefaultMeasurementPending(false);
		});

		onCleanup(() => cancelAnimationFrame(frameId));
	});

	// Set up ResizeObserver to track content area size
	createEffect(() => {
		if (!contentRef) return;

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				setContentSize({
					width: entry.contentRect.width,
					height: entry.contentRect.height,
				});
			}
		});

		resizeObserver.observe(contentRef);

		onCleanup(() => {
			resizeObserver.disconnect();
		});
	});

	createEffect(() => {
		const size = contentSize();
		if (!size || size.height <= 0 || size.width <= 0) return;
		if (defaultRowHeightPx() === undefined && defaultMeasurementPending()) {
			return;
		}

		const rowCount = Math.max(1, screenshotRows().length);
		const availableHeight = Math.max(0, size.height - PANEL_PADDING_Y_PX);
		const visibleRows = getDefaultVisibleRowCount(rowCount);
		const currentDefaultRowHeight =
			defaultRowHeightPx() ??
			calculateDefaultRowHeight(availableHeight, rowCount);
		const currentDefaultSingleRowPanelHeight =
			defaultSingleRowPanelHeightPx() ?? size.height / visibleRows;

		if (defaultRowHeightPx() === undefined) {
			setDefaultRowHeightPx(currentDefaultRowHeight);
		}
		if (defaultSingleRowPanelHeightPx() === undefined) {
			setDefaultSingleRowPanelHeightPx(currentDefaultSingleRowPanelHeight);
		}

		const rowHeight = calculateRowHeight(
			size.height,
			availableHeight,
			rowCount,
			currentDefaultRowHeight,
			currentDefaultSingleRowPanelHeight,
		);
		setRowHeightPx(rowHeight);
		if (rowHeight <= 0) {
			setSlotCount(0);
			return;
		}

		const screenshotWidth = rowHeight * SCREENSHOT_ASPECT_RATIO;
		const count = Math.floor(
			(size.width + ROW_GAP_PX) / (screenshotWidth + ROW_GAP_PX),
		);
		setSlotCount(Math.max(0, count));
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
				(screenshot) =>
					screenshot.original.contextId === row.contextId &&
					screenshot.original.pageId === row.pageIds[0],
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
										style={{ height: `${rowHeightPx()}px` }}
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

function groupScreenshotsByPage(screenshots: ScreenshotInfo[]): ScreenshotRow[] {
	const rows = new Map<string, ScreenshotRow>();
	for (const screenshot of screenshots) {
		const id = `${screenshot.contextId}:${screenshot.pageId}`;
		const row = rows.get(id) ?? {
			id,
			contextId: screenshot.contextId,
			pageIds: [],
			screenshots: [],
		};
		if (!row.pageIds.includes(screenshot.pageId)) {
			row.pageIds.push(screenshot.pageId);
		}
		row.screenshots.push(screenshot);
		rows.set(id, row);
	}

	return Array.from(rows.values()).map((row) => ({
		...row,
		pageIds: row.pageIds.sort(),
		screenshots: row.screenshots.sort((a, b) => a.timestamp - b.timestamp),
	}));
}

function getDefaultVisibleRowCount(rowCount: number): number {
	if (rowCount <= 1) return 1;
	if (rowCount === 2) return 2;
	return 2.5;
}

function calculateDefaultRowHeight(
	availableHeight: number,
	rowCount: number,
): number {
	const visibleRows = getDefaultVisibleRowCount(rowCount);
	const visibleGaps = Math.max(0, Math.ceil(visibleRows) - 1);
	return Math.max(
		0,
		(availableHeight - visibleGaps * ROW_GAP_PX) / visibleRows,
	);
}

function calculateRowHeight(
	contentHeight: number,
	availableHeight: number,
	rowCount: number,
	defaultRowHeight: number,
	defaultSingleRowPanelHeight: number,
): number {
	const defaultTotalHeight =
		defaultRowHeight * rowCount + ROW_GAP_PX * (rowCount - 1);

	if (contentHeight < defaultSingleRowPanelHeight) {
		return availableHeight;
	}

	if (availableHeight > defaultTotalHeight) {
		return Math.max(
			0,
			(availableHeight - ROW_GAP_PX * (rowCount - 1)) / rowCount,
		);
	}

	return defaultRowHeight;
}
