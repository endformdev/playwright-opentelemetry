import {
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import type { ScreenshotInfo } from "../trace-info-loader";
import {
	countFilmstripSlots,
	FilmstripRow,
	groupScreenshotsByPage,
	SCREENSHOT_ASPECT_RATIO,
} from "./FilmstripRow";
import { findScreenshotAtTime } from "./screenshots";
import {
	type TimelineViewport,
	timeToViewportPosition,
	viewportPositionToTime,
} from "./viewport";

export interface ScreenshotFilmstripProps {
	screenshots: ScreenshotInfo[];
	screenshotsLoading: boolean;
	/** The visible window, which the rows span like the span panels do */
	viewport: TimelineViewport;
	testStartTimeMs: number;
	/** The locked time, marked with a line; null when unlocked */
	lockedTimeMs: number | null;
	/** Time hovered elsewhere (the ruler or span panels), marked with a line */
	hoverTimeMs: number | null;
	/** Names the moment a time falls in, e.g. `7. Navigate · 900ms` */
	describeTime: (timeMs: number) => string;
	/**
	 * Where the zoomed frame may open: the area below the player, over the
	 * span panels. Null when there is nothing below, so there is no zoom.
	 */
	zoomArea: () => DOMRect | null;
	onPointerTime: (timeMs: number | null) => void;
	/** A click on a frame locks that exact time */
	onSeek: (timeMs: number) => void;
	onWheel: (event: WheelEvent, plot: DOMRect) => void;
}

const PADDING_Y_PX = 12;
const ROW_GAP_PX = 8;
const MIN_ROW_HEIGHT_PX = 48;
const MAX_ROW_HEIGHT_PX = 100;
/** Room the zoomed frame needs to be worth showing */
const MIN_ZOOM_HEIGHT_PX = 120;
const MAX_ZOOM_WIDTH_PX = 480;
const ZOOM_MARGIN_PX = 12;
const ZOOM_CAPTION_HEIGHT_PX = 26;

interface FilmstripPointer {
	timeMs: number;
	clientX: number;
	/** The page whose row is under the pointer, or null between rows */
	pageId: string | null;
}

/**
 * The step viewer's filmstrip screen: a row of frames per page in place of
 * the big screenshot, across the visible window so it lines up with the span
 * panels and gets denser as they zoom. Hovering a frame zooms it in a box
 * below the player, named with the step at that moment.
 */
export function ScreenshotFilmstrip(props: ScreenshotFilmstripProps) {
	let rootRef: HTMLDivElement | undefined;
	let plotRef: HTMLDivElement | undefined;
	const [size, setSize] = createSignal({ width: 0, height: 0 });
	const [plotWidthPx, setPlotWidthPx] = createSignal(0);
	const [pointer, setPointer] = createSignal<FilmstripPointer | null>(null);
	const aspectRatios = new Map<string, number>();
	const [aspectVersion, setAspectVersion] = createSignal(0);

	onMount(() => {
		const observer = new ResizeObserver(() => {
			if (rootRef) {
				setSize({ width: rootRef.clientWidth, height: rootRef.clientHeight });
			}
			if (plotRef) setPlotWidthPx(plotRef.getBoundingClientRect().width);
		});
		if (rootRef) observer.observe(rootRef);
		if (plotRef) observer.observe(plotRef);
		onCleanup(() => observer.disconnect());
	});

	const pages = createMemo(() => groupScreenshotsByPage(props.screenshots));
	const range = () => ({
		startMs: props.viewport.visibleStartMs,
		endMs: props.viewport.visibleEndMs,
	});
	/** Rows share the height, within bounds; below the minimum they scroll. */
	const rowHeightPx = () => {
		const count = Math.max(1, pages().length);
		const available =
			size().height - 2 * PADDING_Y_PX - ROW_GAP_PX * (count - 1);
		return Math.max(
			MIN_ROW_HEIGHT_PX,
			Math.min(MAX_ROW_HEIGHT_PX, available / count),
		);
	};
	const slotCount = () => countFilmstripSlots(plotWidthPx(), rowHeightPx());

	const lineAt = (timeMs: number | null) => {
		if (timeMs === null) return null;
		const position = timeToViewportPosition(timeMs, props.viewport);
		return position >= 0 && position <= 1 ? position * 100 : null;
	};
	const pointerLine = () => lineAt(pointer()?.timeMs ?? props.hoverTimeMs);
	const lockedLine = () => lineAt(props.lockedTimeMs);

	const timeAt = (clientX: number) => {
		const rect = plotRef?.getBoundingClientRect();
		if (!rect || rect.width <= 0) return null;
		const position = Math.max(
			0,
			Math.min(1, (clientX - rect.left) / rect.width),
		);
		return viewportPositionToTime(position, props.viewport);
	};

	const handleMouseMove = (event: MouseEvent) => {
		const timeMs = timeAt(event.clientX);
		if (timeMs === null) return;
		const row =
			event.target instanceof Element
				? event.target.closest<HTMLElement>("[data-testid=screenshot-row]")
				: null;
		setPointer({
			timeMs,
			clientX: event.clientX,
			pageId: row?.dataset.screenshotPageId ?? null,
		});
		props.onPointerTime(timeMs);
	};

	const handleMouseLeave = () => {
		setPointer(null);
		props.onPointerTime(null);
	};

	const handleClick = (event: MouseEvent) => {
		const timeMs = timeAt(event.clientX);
		if (timeMs !== null) props.onSeek(timeMs);
	};

	const handleWheel = (event: WheelEvent) => {
		const rect = plotRef?.getBoundingClientRect();
		if (rect) props.onWheel(event, rect);
	};

	/** The hovered page's frame at the pointer, zoomed below the player */
	const zoom = createMemo(() => {
		aspectVersion();
		const current = pointer();
		if (!current?.pageId) return null;
		const page = pages().find(
			(candidate) => candidate.pageId === current.pageId,
		);
		const screenshot = page
			? findScreenshotAtTime(
					page.screenshots,
					props.testStartTimeMs + current.timeMs,
				)
			: null;
		const area = props.zoomArea();
		if (!screenshot || !area || area.height < MIN_ZOOM_HEIGHT_PX) return null;

		const aspectRatio =
			aspectRatios.get(screenshot.url) ??
			aspectRatios.get(screenshot.pageId) ??
			SCREENSHOT_ASPECT_RATIO;
		const maxImageHeight =
			area.height - 2 * ZOOM_MARGIN_PX - ZOOM_CAPTION_HEIGHT_PX;
		const width = Math.min(
			MAX_ZOOM_WIDTH_PX,
			area.width - 2 * ZOOM_MARGIN_PX,
			maxImageHeight * aspectRatio,
		);
		if (width <= 0) return null;
		const leftEdge = area.left + ZOOM_MARGIN_PX;
		const rightEdge = area.right - ZOOM_MARGIN_PX;
		return {
			screenshot,
			caption: props.describeTime(current.timeMs),
			left: Math.max(
				leftEdge,
				Math.min(current.clientX - width / 2, rightEdge - width),
			),
			top: area.top + ZOOM_MARGIN_PX,
			width,
			imageHeight: width / aspectRatio,
		};
	});

	const rememberAspect = (
		image: HTMLImageElement,
		screenshot: ScreenshotInfo,
	) => {
		if (!image.naturalWidth || !image.naturalHeight) return;
		const aspectRatio = image.naturalWidth / image.naturalHeight;
		aspectRatios.set(screenshot.url, aspectRatio);
		aspectRatios.set(screenshot.pageId, aspectRatio);
		setAspectVersion((version) => version + 1);
	};

	return (
		<div
			ref={rootRef}
			class="relative h-full overflow-y-auto overflow-x-hidden bg-gray-100"
			role="region"
			aria-label="Screenshots"
			data-testid="step-viewer-filmstrip"
			onMouseMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
			onClick={handleClick}
			onWheel={handleWheel}
		>
			<div
				class="flex min-h-full flex-col justify-center"
				style={{
					"padding-top": `${PADDING_Y_PX}px`,
					"padding-bottom": `${PADDING_Y_PX}px`,
				}}
			>
				<div
					ref={plotRef}
					class="relative flex flex-col"
					style={{
						"margin-left": "var(--timeline-plot-inset)",
						width: "var(--timeline-plot-width)",
						gap: `${ROW_GAP_PX}px`,
					}}
				>
					<Show
						when={pages().length > 0}
						fallback={
							<div class="flex h-24 items-center justify-center text-sm text-gray-400">
								{props.screenshotsLoading
									? "Loading screenshots..."
									: "No screenshots available"}
							</div>
						}
					>
						<For each={pages()}>
							{(page) => (
								<FilmstripRow
									page={page}
									numbered={pages().length > 1}
									heightPx={rowHeightPx()}
									slotCount={slotCount()}
									range={range()}
									testStartTimeMs={props.testStartTimeMs}
									pointerTimeMs={pointer()?.timeMs ?? null}
								/>
							)}
						</For>
					</Show>

					<Show when={lockedLine() !== null}>
						<div
							class="pointer-events-none absolute -inset-y-1 z-30 -ml-px w-[3px] bg-blue-600"
							style={{ left: `${lockedLine()}%` }}
						/>
					</Show>
					<Show when={pointerLine() !== null}>
						<div
							class="pointer-events-none absolute -inset-y-1 z-30 w-px bg-blue-500"
							style={{ left: `${pointerLine()}%` }}
						/>
					</Show>
				</div>
			</div>

			<Show when={zoom()}>
				{(current) => (
					<Portal>
						<div
							aria-hidden="true"
							class="pointer-events-none fixed z-50 overflow-hidden rounded-lg bg-white shadow-xl ring-1 ring-gray-300"
							style={{
								left: `${current().left}px`,
								top: `${current().top}px`,
								width: `${current().width}px`,
							}}
							data-testid="screenshot-zoom"
							data-screenshot-timestamp={current().screenshot.timestamp}
							data-screenshot-page-id={current().screenshot.pageId}
						>
							<img
								src={current().screenshot.url}
								alt=""
								class="block w-full object-contain"
								style={{ height: `${current().imageHeight}px` }}
								onLoad={(event) =>
									rememberAspect(event.currentTarget, current().screenshot)
								}
							/>
							<div
								class="truncate border-t border-gray-200 px-2 text-[11px] text-gray-700"
								style={{ "line-height": `${ZOOM_CAPTION_HEIGHT_PX - 1}px` }}
								data-testid="screenshot-zoom-caption"
							>
								{current().caption}
							</div>
						</div>
					</Portal>
				)}
			</Show>
		</div>
	);
}
