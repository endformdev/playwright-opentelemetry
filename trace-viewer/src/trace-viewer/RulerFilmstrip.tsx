import {
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import type { ScreenshotInfo } from "../trace-info-loader";
import { countFilmstripSlots, FilmstripRow } from "./FilmstripRow";
import { groupScreenshotsByPage } from "./screenshots";

export interface RulerFilmstripProps {
	/** Whether the pointer is on the ruler, so the filmstrip is shown */
	open: boolean;
	/** Above the ruler (over the player) or below it (over the span panels) */
	placement: "above" | "below";
	screenshots: ScreenshotInfo[];
	testStartTimeMs: number;
	durationMs: number;
	/** Time under the pointer, relative to test start */
	pointerTimeMs: number | null;
	/** Names what is under the pointer, e.g. `7. Navigate · 900ms` */
	label: string;
}

/** Rows get shorter as pages are added, so several still fit over the player. */
function getRowHeightPx(rowCount: number): number {
	if (rowCount <= 1) return 72;
	if (rowCount === 2) return 60;
	return 48;
}

/**
 * Screenshots across the whole test, one row per page, shown while the
 * pointer is on the step ruler. It lines up in time with the ruler, and fades
 * in and out where it stands so nothing on screen moves.
 */
export function RulerFilmstrip(props: RulerFilmstripProps) {
	let plotRef: HTMLDivElement | undefined;
	const [plotWidthPx, setPlotWidthPx] = createSignal(0);
	onMount(() => {
		if (!plotRef) return;
		const observer = new ResizeObserver(([entry]) => {
			if (entry) setPlotWidthPx(entry.contentRect.width);
		});
		observer.observe(plotRef);
		onCleanup(() => observer.disconnect());
	});

	const rows = createMemo(() => groupScreenshotsByPage(props.screenshots));

	const rowHeightPx = () => getRowHeightPx(rows().length);
	const slotCount = () => countFilmstripSlots(plotWidthPx(), rowHeightPx());
	const range = () => ({ startMs: 0, endMs: props.durationMs });

	const toPercent = (timeMs: number) =>
		props.durationMs > 0
			? Math.max(0, Math.min(100, (timeMs / props.durationMs) * 100))
			: 0;
	const pointerPercent = () =>
		props.pointerTimeMs === null ? null : toPercent(props.pointerTimeMs);
	return (
		<div
			class="pointer-events-none absolute inset-x-0 z-[60] border-gray-200 bg-white py-2 transition-[opacity,visibility] duration-150"
			classList={{
				"bottom-full border-t": props.placement === "above",
				"top-full border-b": props.placement === "below",
				"visible opacity-100": props.open,
				"invisible opacity-0": !props.open,
			}}
			data-testid="ruler-filmstrip"
			aria-hidden="true"
		>
			{/*
			  The filmstrip and the ruler are one surface, so its depth only falls
			  away from the ruler, in a band as wide as the panel.
			*/}
			<div
				class="absolute inset-x-0 h-3 from-gray-900/[0.07] to-transparent"
				classList={{
					"bottom-full bg-gradient-to-t": props.placement === "above",
					"top-full bg-gradient-to-b": props.placement === "below",
				}}
			/>

			{/*
			  The padding under the frames still counts as the ruler while the
			  filmstrip is open, so a small slip upwards keeps scrubbing. It stops
			  short of the control bar's buttons, so they still take clicks.
			*/}
			<Show when={props.placement === "above"}>
				<div class="pointer-events-auto absolute inset-x-0 bottom-0 h-2" />
			</Show>
			<div
				ref={plotRef}
				class="relative flex gap-1.5"
				classList={{
					"flex-col": props.placement === "above",
					"flex-col-reverse": props.placement === "below",
				}}
				style={{
					"margin-left": "var(--timeline-plot-inset)",
					width: "var(--timeline-plot-width)",
				}}
			>
				{/* The label rides along with the pointer, kept inside the plot */}
				<div class="relative h-5">
					<Show when={pointerPercent() !== null}>
						<div
							class="absolute top-0 max-w-[70%] truncate rounded bg-gray-900 px-1.5 text-[11px] leading-5 text-white"
							style={{
								left: `${pointerPercent()}%`,
								transform: `translateX(-${pointerPercent()}%)`,
							}}
							data-testid="ruler-filmstrip-label"
						>
							{props.label}
						</div>
					</Show>
				</div>

				<div class="flex flex-col gap-1">
					<For each={rows()}>
						{(page) => (
							<FilmstripRow
								page={page}
								numbered={rows().length > 1}
								heightPx={rowHeightPx()}
								slotCount={slotCount()}
								range={range()}
								testStartTimeMs={props.testStartTimeMs}
								pointerTimeMs={props.pointerTimeMs}
							/>
						)}
					</For>
				</div>

				{/* From the label, across the padding, into the ruler's hover line */}
				<Show when={pointerPercent() !== null}>
					<div
						class="absolute z-30 w-px bg-gray-900"
						classList={{
							"top-5 -bottom-2": props.placement === "above",
							"-top-2 bottom-5": props.placement === "below",
						}}
						style={{ left: `${pointerPercent()}%` }}
						data-testid="ruler-filmstrip-line"
					/>
				</Show>
			</div>
		</div>
	);
}
