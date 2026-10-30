import { ChevronLeft, ChevronRight } from "lucide-solid";
import { For, Show } from "solid-js";
import type { Span } from "../trace-data-loader/exportToSpans";
import type { ScreenshotInfo } from "../trace-info-loader";
import type { StepStop } from "./stepStops";

export interface StepViewerProps {
	/** Screenshot for the displayed time (hovered or locked) */
	screenshot: ScreenshotInfo | null;
	screenshotsLoading: boolean;
	stopCount: number;
	/** Index of the locked stop, or null when not positioned on a stop */
	stopIndex: number | null;
	stopEdge: StepStop["edge"] | null;
	step: Span | null;
	/** Titles of the step's ancestors below the test, outermost first */
	stepPath: string[];
	ref: (element: HTMLElement) => void;
	onActivate: () => void;
	onNavigate: (direction: -1 | 1) => void;
}

/**
 * Large screenshot of the current moment in the test. While it has focus or
 * the timeline is on one of its stops, the trace viewer's Left/Right keys step
 * through it one step boundary at a time and Home/End jump to the ends.
 */
export function StepViewer(props: StepViewerProps) {
	const atFirst = () => props.stopIndex === 0;
	const atLast = () => props.stopIndex === props.stopCount - 1;

	const navigationButton = (direction: -1 | 1) => (
		<button
			type="button"
			class="absolute top-1/2 z-10 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-600 opacity-0 shadow-md ring-1 ring-gray-200 transition-opacity hover:text-gray-900 group-hover:opacity-100 group-focus-within:opacity-100 disabled:!opacity-0"
			classList={{ "left-3": direction === -1, "right-3": direction === 1 }}
			aria-label={direction === -1 ? "Previous step" : "Next step"}
			disabled={
				props.stopCount === 0 ||
				(props.stopIndex !== null && (direction === -1 ? atFirst() : atLast()))
			}
			onClick={(event) => {
				event.stopPropagation();
				props.onNavigate(direction);
			}}
		>
			{direction === -1 ? (
				<ChevronLeft size={18} aria-hidden="true" />
			) : (
				<ChevronRight size={18} aria-hidden="true" />
			)}
		</button>
	);

	return (
		<section
			ref={props.ref}
			class="group relative flex h-full flex-col bg-gray-100 outline-none"
			aria-label="Step viewer"
			tabIndex={0}
			onClick={props.onActivate}
		>
			{/* Always reserved so the screenshot keeps its size while stepping. */}
			<div class="flex h-7 flex-shrink-0 items-center justify-center px-14 pt-1">
				<Show when={props.step}>
					{(step) => (
						<div
							class="flex min-w-0 max-w-full items-baseline gap-2 rounded-full bg-gray-900/85 px-2.5 py-0.5 text-[11px] text-white shadow-sm"
							data-testid="step-viewer-step"
						>
							<span
								class="flex-shrink-0 font-mono tabular-nums text-white/60"
								data-testid="step-viewer-position"
							>
								{(props.stopIndex ?? 0) + 1}/{props.stopCount}
							</span>
							<For each={props.stepPath}>
								{(title) => (
									<span class="flex-shrink-0 truncate text-white/60">
										{title} ›
									</span>
								)}
							</For>
							<span
								class="truncate font-medium"
								data-testid="step-viewer-step-title"
							>
								{step().title}
							</span>
							<span
								class="flex-shrink-0 rounded-full bg-white/15 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/80"
								data-testid="step-viewer-edge"
							>
								{props.stopEdge}
							</span>
						</div>
					)}
				</Show>
			</div>

			<div class="relative min-h-0 flex-1 px-3 pt-1.5 pb-3">
				<Show
					when={props.screenshot}
					fallback={
						<div class="flex h-full items-center justify-center text-sm text-gray-400">
							{props.screenshotsLoading
								? "Loading screenshots..."
								: "No screenshot at this time"}
						</div>
					}
				>
					{(screenshot) => (
						<img
							src={screenshot().url}
							alt={`Step viewer screenshot at ${screenshot().timestamp}`}
							data-screenshot-timestamp={screenshot().timestamp}
							class="h-full w-full select-none object-contain drop-shadow-md"
							draggable={false}
						/>
					)}
				</Show>
			</div>

			{navigationButton(-1)}
			{navigationButton(1)}
		</section>
	);
}
