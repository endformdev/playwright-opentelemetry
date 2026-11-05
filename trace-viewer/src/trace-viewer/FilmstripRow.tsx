import { Index, Show } from "solid-js";
import { findScreenshotAtTime, type ScreenshotPage } from "./screenshots";
import { selectScreenshots, type TimeRange } from "./selectScreenshots";

export const FILMSTRIP_SLOT_GAP_PX = 4;
export const SCREENSHOT_ASPECT_RATIO = 16 / 9;

/** How many frames of a row's height fit across a width. */
export function countFilmstripSlots(
	widthPx: number,
	rowHeightPx: number,
): number {
	const slotWidth = rowHeightPx * SCREENSHOT_ASPECT_RATIO;
	return Math.max(
		1,
		Math.floor(
			(widthPx + FILMSTRIP_SLOT_GAP_PX) / (slotWidth + FILMSTRIP_SLOT_GAP_PX),
		),
	);
}

/** The slot a time falls in, or null outside the range. */
export function getFilmstripSlotAt(
	timeMs: number,
	range: TimeRange,
	slotCount: number,
): number | null {
	const durationMs = range.endMs - range.startMs;
	if (durationMs <= 0) return null;
	const fraction = (timeMs - range.startMs) / durationMs;
	if (fraction < 0 || fraction > 1) return null;
	return Math.min(slotCount - 1, Math.floor(fraction * slotCount));
}

export interface FilmstripRowProps {
	page: ScreenshotPage;
	/** Badges each row with its page number when there are several */
	numbered: boolean;
	heightPx: number;
	slotCount: number;
	/** The times the row spans, relative to test start */
	range: TimeRange;
	testStartTimeMs: number;
	/** Time under the pointer, relative to test start */
	pointerTimeMs: number | null;
}

/**
 * One page's frames across a time range, laid out to fill its width. Each
 * frame stands for the slice of time it sits over and shows the latest frame
 * at its start, except the one under the pointer, which shows the frame at
 * the pointer and is ringed.
 */
export function FilmstripRow(props: FilmstripRowProps) {
	const pointerSlot = () =>
		props.pointerTimeMs === null
			? null
			: getFilmstripSlotAt(props.pointerTimeMs, props.range, props.slotCount);

	const slots = () =>
		selectScreenshots(props.page.screenshots, props.slotCount, {
			startMs: props.testStartTimeMs + props.range.startMs,
			endMs: props.testStartTimeMs + props.range.endMs,
		});

	return (
		<div
			class="relative flex-shrink-0"
			style={{ height: `${props.heightPx}px` }}
			data-testid="screenshot-row"
			data-screenshot-page-id={props.page.pageId}
			data-screenshot-source-count={props.page.screenshots.length}
		>
			<Index each={slots()}>
				{(sampled, index) => {
					const underPointer = () => index === pointerSlot();
					// The frame under the pointer is the one at the pointer.
					const screenshot = () => {
						if (!underPointer() || props.pointerTimeMs === null) {
							return sampled();
						}
						return (
							findScreenshotAtTime(
								props.page.screenshots,
								props.testStartTimeMs + props.pointerTimeMs,
							) ?? sampled()
						);
					};
					return (
						<div
							class="absolute inset-y-0 overflow-hidden rounded-sm"
							classList={{
								"bg-white": !!screenshot(),
								"ring-1 ring-gray-200": !!screenshot() && !underPointer(),
								"z-10 ring-2 ring-gray-900": !!screenshot() && underPointer(),
							}}
							style={{
								left: `${(index / props.slotCount) * 100}%`,
								width: `calc(${100 / props.slotCount}% - ${FILMSTRIP_SLOT_GAP_PX}px)`,
							}}
							data-under-pointer={underPointer() ? "true" : undefined}
						>
							<Show when={screenshot()}>
								{(shown) => (
									<img
										src={shown().url}
										alt={`Screenshot at ${shown().timestamp}`}
										data-screenshot-timestamp={shown().timestamp}
										data-screenshot-page-id={shown().pageId}
										class="h-full w-full select-none object-contain"
										draggable={false}
									/>
								)}
							</Show>
						</div>
					);
				}}
			</Index>
			<Show when={props.numbered}>
				<span class="absolute top-1 left-1 z-20 flex h-4 min-w-4 items-center justify-center rounded-full bg-gray-900/80 px-1 font-mono text-[9px] leading-none text-white shadow-sm ring-1 ring-white/80">
					{props.page.number}
				</span>
			</Show>
		</div>
	);
}
