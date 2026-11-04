import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	type Resource,
	Show,
} from "solid-js";
import { Portal } from "solid-js/web";

import type { ScreenshotInfo } from "../trace-info-loader";

import {
	type Screenshot,
	type SlotScreenshot,
	selectScreenshots,
	viewportToTimeRange,
} from "./selectScreenshots";
import { findScreenshotAtTime } from "./screenshots";
import { type TimelineViewport, viewportPositionToTime } from "./viewport";

export interface ScreenshotFilmstripProps {
	screenshots: Resource<ScreenshotInfo[]>;
	/** Current viewport state for selecting screenshots */
	viewport: TimelineViewport;
	/** Test start time in milliseconds (Unix timestamp) for converting absolute to relative timestamps */
	testStartTimeMs: number;
	/** Callback when hovering over a screenshot (url) or null when leaving */
	onScreenshotHover?: (screenshotUrl: string | null) => void;
	previewEnabled: boolean;
}

/** Screenshot with relative timestamp for selection, keeping original data */
interface RelativeScreenshot extends Screenshot {
	original: ScreenshotInfo;
}

/** Selected screenshot for a slot - null means empty slot */
type SelectedSlot = SlotScreenshot<ScreenshotInfo>;

interface ScreenshotRow {
	pageId: string;
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
	const [preview, setPreview] = createSignal<{
		screenshot: ScreenshotInfo;
		left: number;
		top: number;
		width: number;
		height: number;
		clientX: number;
	} | null>(null);
	const dismissPreview = () => setPreview(null);
	const aspectRatios = new Map<string, number>();
	const pageAspectRatios = new Map<string, number>();
	createEffect(() => {
		if (!props.previewEnabled) dismissPreview();
	});
	const showPreview = (clientX: number, screenshot: ScreenshotInfo) => {
		if (!props.previewEnabled) return dismissPreview();
		const viewer = contentRef?.closest("main");
		const bounds = viewer?.getBoundingClientRect();
		const leftEdge = Math.max(0, bounds?.left ?? 0) + 12;
		const rightEdge =
			Math.min(window.innerWidth, bounds?.right ?? window.innerWidth) - 12;
		const bottomEdge =
			Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight) - 12;
		// Anchor to the span section, independent of vertical pointer movement.
		const steps = viewer?.querySelector(
			'[role="region"][aria-label="Steps Timeline"]',
		);
		const top =
			steps?.getBoundingClientRect().top ??
			contentRef?.getBoundingClientRect().bottom;
		if (top === undefined) return dismissPreview();
		const previous = preview();
		// Keep the white preview at its last known size while the next image loads.
		const aspectRatio =
			aspectRatios.get(screenshot.url) ??
			(previous?.screenshot.pageId === screenshot.pageId
				? previous.width / previous.height
				: pageAspectRatios.get(screenshot.pageId)) ??
			SCREENSHOT_ASPECT_RATIO;
		const width = Math.min(
			480,
			rightEdge - leftEdge,
			(bottomEdge - top) * aspectRatio,
		);
		if (width <= 0) return dismissPreview();
		setPreview({
			screenshot,
			left: Math.max(
				leftEdge,
				Math.min(clientX - width / 2, rightEdge - width),
			),
			top,
			width,
			height: width / aspectRatio,
			clientX,
		});
	};

	const rememberImageSize = (
		image: HTMLImageElement,
		screenshot: ScreenshotInfo,
	) => {
		if (
			image.getAttribute("src") !== screenshot.url ||
			!image.naturalWidth ||
			!image.naturalHeight
		)
			return;
		const aspectRatio = image.naturalWidth / image.naturalHeight;
		aspectRatios.set(screenshot.url, aspectRatio);
		pageAspectRatios.set(screenshot.pageId, aspectRatio);
		const active = preview();
		if (active?.screenshot.url === screenshot.url) {
			showPreview(active.clientX, active.screenshot);
		}
	};

	createEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") dismissPreview();
		};
		const onScroll = (event: Event) => {
			// Details-panel auto-scrolling does not move the filmstrip or its preview.
			if (
				event.target === document ||
				(event.target instanceof Element &&
					contentRef &&
					event.target.contains(contentRef))
			)
				dismissPreview();
		};
		window.addEventListener("resize", dismissPreview);
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("blur", dismissPreview);
		window.addEventListener("keydown", onKeyDown);
		onCleanup(() => {
			window.removeEventListener("resize", dismissPreview);
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("blur", dismissPreview);
			window.removeEventListener("keydown", onKeyDown);
		});
	});

	const [slotCount, setSlotCount] = createSignal(0);
	const [contentSize, setContentSize] = createSignal<{
		width: number;
		height: number;
	} | null>(null);
	const [defaultRowHeightPx, setDefaultRowHeightPx] = createSignal<
		number | undefined
	>();
	const [defaultMeasurementPending, setDefaultMeasurementPending] =
		createSignal(true);
	const [rowHeightPx, setRowHeightPx] = createSignal(0);
	const screenshots = () => props.screenshots() ?? [];
	const screenshotRows = createMemo(() =>
		groupScreenshotsByPage(screenshots()),
	);
	const screenshotRowsKey = createMemo(() =>
		screenshotRows()
			.map((row) => row.pageId)
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
				const rect = entry.target.getBoundingClientRect();
				setContentSize({
					width: rect.width,
					height: rect.height,
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
		const currentDefaultRowHeight =
			defaultRowHeightPx() ??
			calculateDefaultRowHeight(availableHeight, rowCount);

		if (defaultRowHeightPx() === undefined) {
			setDefaultRowHeightPx(currentDefaultRowHeight);
		}

		const rowHeight = calculateRowHeight(
			availableHeight,
			rowCount,
			currentDefaultRowHeight,
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
	// 1. Showing the latest screenshot at or before each slot starts
	// 2. When no screenshot in slot bounds, showing closest earlier screenshot
	// 3. When zoomed into an empty region, showing closest earlier screenshot repeated
	// 4. null entries for slots where no screenshot exists yet (respects causality)
	const selectedScreenshotRows = createMemo((): SelectedScreenshotRow[] => {
		const timeRange = viewportToTimeRange(props.viewport);
		return screenshotRows().map((row) => {
			const rowScreenshots = screenshotsWithRelativeTime().filter(
				(screenshot) => screenshot.original.pageId === row.pageId,
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

	// Always report the hovered screenshot so the live pointer identity stays
	// current while locked; only the enlarged preview depends on the mode.
	const handleRowHover = (event: MouseEvent, row: SelectedScreenshotRow) => {
		const timeline = contentRef
			?.closest('[aria-label="Trace timeline"]')
			?.querySelector("[data-timeline-plot]")
			?.getBoundingClientRect();
		if (!timeline || timeline.width <= 0) return dismissPreview();
		const position = Math.max(
			0,
			Math.min(1, (event.clientX - timeline.left) / timeline.width),
		);
		const screenshot = findScreenshotAtTime(
			row.screenshots,
			props.testStartTimeMs + viewportPositionToTime(position, props.viewport),
		);
		props.onScreenshotHover?.(
			screenshot?.url ?? row.screenshots[0]?.url ?? null,
		);
		if (screenshot && props.previewEnabled && event.buttons === 0) {
			showPreview(event.clientX, screenshot);
		} else {
			dismissPreview();
		}
	};

	const handleLeave = () => {
		dismissPreview();
		props.onScreenshotHover?.(null);
	};

	return (
		<div
			ref={contentRef}
			class="h-full bg-gray-50 overflow-y-auto overflow-x-hidden p-2"
			role="region"
			aria-label="Screenshots"
			onMouseLeave={handleLeave}
			onMouseDown={dismissPreview}
		>
			<Show when={preview()}>
				{(current) => (
					<Portal>
						<div
							aria-hidden="true"
							data-testid="screenshot-hover-preview"
							data-screenshot-timestamp={current().screenshot.timestamp}
							data-screenshot-page-id={current().screenshot.pageId}
							class="fixed z-50 pointer-events-none rounded-lg ring-1 ring-gray-300 bg-white shadow-xl overflow-hidden"
							style={{
								left: `${current().left}px`,
								top: `${current().top}px`,
								width: `${current().width}px`,
								height: `${current().height}px`,
							}}
						>
							<img
								src={current().screenshot.url}
								onLoad={(event) =>
									rememberImageSize(event.currentTarget, current().screenshot)
								}
								alt=""
								class="w-full h-full object-contain"
							/>
						</div>
					</Portal>
				)}
			</Show>
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
										data-screenshot-page-id={row.pageId}
										data-screenshot-source-count={row.screenshots.length}
										onMouseEnter={(event) => handleRowHover(event, row)}
										onMouseMove={(event) => handleRowHover(event, row)}
										onMouseLeave={dismissPreview}
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
															data-screenshot-page-id={s().pageId}
														>
															<img
																src={s().url}
																onLoad={(event) =>
																	rememberImageSize(event.currentTarget, s())
																}
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

function groupScreenshotsByPage(
	screenshots: ScreenshotInfo[],
): ScreenshotRow[] {
	const rows = new Map<string, ScreenshotRow>();
	for (const screenshot of screenshots) {
		const row = rows.get(screenshot.pageId) ?? {
			pageId: screenshot.pageId,
			screenshots: [],
		};
		row.screenshots.push(screenshot);
		rows.set(screenshot.pageId, row);
	}

	return Array.from(rows.values()).map((row) => ({
		...row,
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
	availableHeight: number,
	rowCount: number,
	defaultRowHeight: number,
): number {
	const defaultTotalHeight =
		defaultRowHeight * rowCount + ROW_GAP_PX * (rowCount - 1);

	if (availableHeight < defaultRowHeight) {
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
