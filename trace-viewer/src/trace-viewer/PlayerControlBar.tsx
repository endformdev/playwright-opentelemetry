import { ChevronLeft, ChevronRight, Pause, Pin, Play } from "lucide-solid";
import { For, Show } from "solid-js";
import { isErrorSpan, type Span } from "../trace-data-loader/exportToSpans";
import { getStepTimelineColor } from "./components/stepSpanStyles";
import { StepTitleText } from "./components/StepTitleText";
import { formatPlaybackSpeed, type PlaybackSpeed } from "./playback";
import type { StepViewerPage } from "./useStepViewer";

export interface PlayerControlBarProps {
	stopCount: number;
	/** Index of the step shown (see StepViewer.shownIndex), or null */
	stopIndex: number | null;
	/**
	 * The shown step and the spans it is nested in, outermost first (see
	 * getStepAncestry); empty when not on a step.
	 */
	stepAncestry: Span[];
	onActivate: () => void;
	onNavigate: (direction: -1 | 1) => void;
	playing: boolean;
	playbackSpeed: PlaybackSpeed;
	onTogglePlayback: () => void;
	onCycleSpeed: () => void;
	pages: StepViewerPage[];
	pinnedPageId: string | null;
	/** The page of the screenshot on screen */
	shownPageId: string | null;
	onPinPage: (pageId: string | null) => void;
}

const BUTTON_CLASS =
	"inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-600 transition-colors enabled:hover:bg-gray-100 enabled:hover:text-gray-900 disabled:cursor-default disabled:opacity-40";

/**
 * The player's one row of controls, under the screenshot: the transport
 * (previous step, play/pause, next step, speed), the step the viewer is on,
 * and with several pages a picker to pin one of them.
 */
export function PlayerControlBar(props: PlayerControlBarProps) {
	const active = () => props.stopIndex !== null;
	const atFirst = () => props.stopIndex === 0;
	const atLast = () => props.stopIndex === props.stopCount - 1;
	const step = () => (active() ? props.stepAncestry.at(-1) : undefined);

	const navigationButton = (direction: -1 | 1) => (
		<button
			type="button"
			class={BUTTON_CLASS}
			aria-label={direction === -1 ? "Previous step" : "Next step"}
			title={direction === -1 ? "Previous step (←)" : "Next step (→)"}
			disabled={
				props.stopCount === 0 ||
				(active() && (direction === -1 ? atFirst() : atLast()))
			}
			onClick={() => props.onNavigate(direction)}
		>
			{direction === -1 ? (
				<ChevronLeft size={18} aria-hidden="true" />
			) : (
				<ChevronRight size={18} aria-hidden="true" />
			)}
		</button>
	);

	return (
		<div
			class="flex h-12 flex-shrink-0 items-center gap-3 border-t border-gray-200 bg-white px-3"
			data-testid="player-control-bar"
		>
			<div
				class="flex flex-shrink-0 items-center gap-0.5"
				role="group"
				aria-label="Playback"
			>
				{navigationButton(-1)}
				<button
					type="button"
					class="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors"
					classList={{
						"bg-blue-600 text-white hover:bg-blue-700": props.playing,
						"bg-gray-900 text-white hover:bg-gray-700": !props.playing,
					}}
					aria-label={props.playing ? "Pause" : "Play"}
					title={props.playing ? "Pause (Space)" : "Play (Space)"}
					onClick={props.onTogglePlayback}
				>
					{props.playing ? (
						<Pause size={14} fill="currentColor" aria-hidden="true" />
					) : (
						<Play
							size={14}
							fill="currentColor"
							class="translate-x-px"
							aria-hidden="true"
						/>
					)}
				</button>
				{navigationButton(1)}
				<button
					type="button"
					class="ml-0.5 inline-flex h-7 min-w-9 flex-shrink-0 items-center justify-center rounded-full px-1.5 font-mono text-[11px] tabular-nums text-gray-500 ring-1 ring-gray-200 transition-colors hover:text-gray-900 hover:ring-gray-300"
					aria-label="Playback speed"
					title="Playback speed: click to change"
					data-testid="playback-speed"
					onClick={props.onCycleSpeed}
				>
					{formatPlaybackSpeed(props.playbackSpeed)}
				</button>
			</div>

			<Show when={props.stopCount > 0}>
				<button
					type="button"
					class="inline-flex h-6 min-w-14 flex-shrink-0 items-center justify-center rounded-full px-2 font-mono text-[11px] tabular-nums transition-colors"
					classList={{
						"bg-blue-600 text-white": active(),
						"bg-gray-100 text-gray-500 hover:text-gray-800": !active(),
					}}
					data-testid="step-viewer-position"
					data-active={active() ? "true" : undefined}
					title={
						props.playing
							? "Playing through the test"
							: active()
								? "Stepping through the test with ← →"
								: "Step through the test with ← →"
					}
					onClick={props.onActivate}
				>
					{active() ? (props.stopIndex ?? 0) + 1 : "–"}/{props.stopCount}
				</button>
			</Show>

			<div class="min-w-0 flex-1">
				<Show when={step()}>
					{(current) => (
						<StepLine
							step={current()}
							depth={props.stepAncestry.length - 1}
							parents={props.stepAncestry
								.slice(0, -1)
								.filter((span) => span.name === "playwright.test.step")}
						/>
					)}
				</Show>
			</div>

			<Show when={props.pages.length > 1}>
				<div
					class="-mr-1 flex max-w-[40%] flex-shrink-0 items-center gap-2 overflow-x-auto p-1"
					role="group"
					aria-label="Pages"
					data-testid="step-viewer-pages"
				>
					<For each={props.pages}>
						{(page) => {
							const pinned = () => props.pinnedPageId === page.pageId;
							const shown = () => props.shownPageId === page.pageId;
							return (
								<button
									type="button"
									class="relative h-8 flex-shrink-0 overflow-hidden rounded bg-white transition"
									classList={{
										"ring-2 ring-blue-600": shown(),
										"opacity-50 ring-1 ring-gray-300 hover:opacity-100":
											!shown(),
									}}
									aria-label={`Page ${page.number}`}
									aria-pressed={pinned()}
									title={
										pinned()
											? `Page ${page.number}, pinned. Click to follow the latest page again.`
											: `Show page ${page.number}`
									}
									onClick={() => props.onPinPage(pinned() ? null : page.pageId)}
								>
									<img
										src={page.screenshot.url}
										alt=""
										class="block aspect-video h-full object-cover object-top"
										draggable={false}
									/>
									<span class="absolute bottom-0 left-0 rounded-tr bg-gray-900/75 px-1 font-mono text-[9px] leading-[13px] text-white">
										{page.number}
									</span>
									<Show when={pinned()}>
										<span class="absolute top-0.5 right-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-600 text-white">
											<Pin size={8} aria-hidden="true" />
										</span>
									</Show>
								</button>
							);
						}}
					</For>
				</div>
			</Show>
		</div>
	);
}

/**
 * The step on one line, title then locator, cut short to fit. The full
 * title, the steps it is nested in and the locator show on hover.
 */
function StepLine(props: { step: Span; depth: number; parents: Span[] }) {
	const color = () =>
		isErrorSpan(props.step)
			? "#dc2626"
			: getStepTimelineColor(props.step, props.depth);
	const tooltip = () =>
		[
			...props.parents.map((parent) => parent.title),
			props.step.title,
			props.step.subtitle,
		]
			.filter(Boolean)
			.join("\n");

	return (
		<div
			class="truncate text-[13px] leading-snug"
			title={tooltip()}
			data-testid="step-viewer-step"
			data-span-id={props.step.id}
		>
			<span
				class="mr-2 inline-block h-2 w-2 rounded-full align-middle"
				style={{ "background-color": color() }}
				aria-hidden="true"
			/>
			<span
				class="font-semibold text-gray-900"
				data-testid="step-viewer-step-title"
			>
				<StepTitleText
					title={props.step.title}
					emphasisColor={`color-mix(in srgb, ${color()} 65%, black)`}
				/>
			</span>
			<Show when={props.step.subtitle}>
				{(subtitle) => (
					<code
						class="ml-2 font-mono text-xs text-gray-500"
						data-testid="step-viewer-step-subtitle"
					>
						{subtitle()}
					</code>
				)}
			</Show>
		</div>
	);
}
