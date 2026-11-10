import {
	ChevronLeft,
	ChevronRight,
	Columns2,
	Maximize2,
	Pause,
	Pin,
	Play,
} from "lucide-solid";
import { For, Show } from "solid-js";
import { isErrorSpan, type Span } from "../trace-data-loader/exportToSpans";
import { getStepTimelineColor } from "./components/stepSpanStyles";
import { StepTitleText } from "./components/StepTitleText";
import { formatPlaybackSpeed, type PlaybackSpeed } from "./playback";
import type { StepViewerPage } from "./useStepViewer";
import type { ViewerAction, ViewerActionId } from "./viewerAction";

export interface PlayerControlBarProps {
	stopCount: number;
	/** Index of the step shown (see the step viewer's shownIndex), or null */
	stopIndex: number | null;
	/**
	 * The shown step and the spans it is nested in, outermost first (see
	 * getStepAncestry); empty when no step is shown.
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
	/** The embedding page's action, a button at the end of the bar */
	action: ViewerAction | null;
	/** The span the embedding page highlights, named before any step inside it */
	highlightedSpanId: string | null;
	/**
	 * Whether the comparison trace is shown beside this one, or null without a
	 * comparison to show, when there is no button for it
	 */
	comparisonShown: boolean | null;
	onToggleComparison: () => void;
}

const ACTION_BUTTONS: Record<
	ViewerActionId,
	{ label: string; icon: typeof Maximize2 }
> = {
	expand: { label: "Expand trace", icon: Maximize2 },
};

const BUTTON_CLASS =
	"inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-gray-600 transition-colors enabled:hover:bg-gray-100 enabled:hover:text-gray-900 disabled:cursor-default disabled:opacity-40";

/**
 * The player's one row of controls, under the screenshot: the transport
 * (previous step, play/pause, next step, speed), the step the viewer is on,
 * with several pages a picker to pin one of them, and when the embedding page
 * asks for one, a button for its action.
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
					class="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md transition-colors"
					classList={{
						"bg-fill-playhead text-gray-950 hover:bg-fill-playhead/90":
							props.playing,
						"bg-gray-900 text-white hover:bg-gray-900/90": !props.playing,
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
					class="ml-0.5 inline-flex h-7 min-w-9 flex-shrink-0 items-center justify-center rounded-md px-1.5 font-mono text-[11px] tabular-nums text-gray-500 ring-1 ring-gray-200 transition-colors hover:text-gray-900 hover:ring-gray-300"
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
					class="min-w-10 flex-shrink-0 text-left font-mono text-[11px] tabular-nums text-gray-500 transition-colors"
					classList={{ "hover:text-gray-800": !active() }}
					data-testid="step-viewer-position"
					data-active={active() ? "true" : undefined}
					title={
						props.playing
							? "Playing through the test"
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
							highlightedSpanId={props.highlightedSpanId}
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
										"ring-2 ring-fill-playhead": shown(),
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
										<span class="absolute top-0.5 right-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-fill-playhead text-gray-950">
											<Pin size={8} aria-hidden="true" />
										</span>
									</Show>
								</button>
							);
						}}
					</For>
				</div>
			</Show>

			<Show when={props.comparisonShown !== null}>
				<button
					type="button"
					class={BUTTON_CLASS}
					classList={{ "bg-gray-100 text-gray-900": !!props.comparisonShown }}
					aria-label={
						props.comparisonShown ? "Hide comparison" : "Show comparison"
					}
					title={props.comparisonShown ? "Hide comparison" : "Show comparison"}
					onClick={props.onToggleComparison}
				>
					<Columns2 size={16} aria-hidden="true" />
				</button>
			</Show>

			<Show when={props.action}>
				{(action) => {
					const button = ACTION_BUTTONS[action().id];
					return (
						<button
							type="button"
							class={BUTTON_CLASS}
							aria-label={button.label}
							title={button.label}
							onClick={() => action().run()}
						>
							<button.icon size={16} aria-hidden="true" />
						</button>
					);
				}}
			</Show>
		</div>
	);
}

/**
 * The step on one line, title then locator, cut short to fit. The full
 * title, the steps it is nested in and the locator show on hover.
 */
function StepLine(props: {
	step: Span;
	depth: number;
	parents: Span[];
	highlightedSpanId: string | null;
}) {
	// The caption names only the innermost step, which alone doesn't show that
	// it is part of the highlighted one.
	const highlightedParent = () =>
		props.parents.find((parent) => parent.id === props.highlightedSpanId);
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
			<Show when={highlightedParent()}>
				{(parent) => (
					<span
						class="text-gray-500"
						data-testid="step-viewer-highlighted-parent"
					>
						{parent().title} ›{" "}
					</span>
				)}
			</Show>
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
