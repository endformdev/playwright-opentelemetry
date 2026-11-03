import { ChevronLeft, ChevronRight, Pin } from "lucide-solid";
import { For, Show } from "solid-js";
import { isErrorSpan, type Span } from "../trace-data-loader/exportToSpans";
import type { ScreenshotInfo } from "../trace-info-loader";
import { getStepTimelineColor } from "./components/stepSpanStyles";
import { StepTitleText } from "./components/StepTitleText";
import type { StepViewerPage } from "./useStepViewer";

export interface StepViewerProps {
	screenshot: ScreenshotInfo | null;
	screenshotsLoading: boolean;
	stopCount: number;
	/** Index of the stop the timeline is locked on, or null when not on one */
	stopIndex: number | null;
	/**
	 * The stop's step and the spans it is nested in, outermost first (see
	 * getStepAncestry); empty when not on a stop.
	 */
	stepAncestry: Span[];
	pages: StepViewerPage[];
	pinnedPageId: string | null;
	onPinPage: (pageId: string | null) => void;
	ref: (element: HTMLElement) => void;
	onActivate: () => void;
	onNavigate: (direction: -1 | 1) => void;
}

/**
 * Large screenshot of the current moment in the test. Left/Right step through
 * the test body's steps, showing each once it has finished; Home/End jump to
 * the first and last step (see useStepViewer for when the keys apply).
 *
 * Controls live in gutters either side of the screenshot so they never cover
 * it: the step counter and back arrow on the left, the page picker and next
 * arrow on the right. The counter lights up while the viewer drives the
 * selection, and the step it is on is named in the top right corner.
 */
export function StepViewer(props: StepViewerProps) {
	const active = () => props.stopIndex !== null;
	const atFirst = () => props.stopIndex === 0;
	const atLast = () => props.stopIndex === props.stopCount - 1;
	const shownPageId = () => props.screenshot?.pageId ?? null;

	const navigationButton = (direction: -1 | 1) => (
		<button
			type="button"
			class="absolute top-1/2 z-10 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white text-gray-600 shadow-md ring-1 ring-gray-200 transition-opacity enabled:hover:text-gray-900 disabled:cursor-default disabled:opacity-40"
			classList={{ "left-5": direction === -1, "right-5": direction === 1 }}
			aria-label={direction === -1 ? "Previous step" : "Next step"}
			disabled={
				props.stopCount === 0 ||
				(active() && (direction === -1 ? atFirst() : atLast()))
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
			class="relative h-full bg-gray-100 outline-none"
			aria-label="Step viewer"
			tabIndex={0}
			onClick={props.onActivate}
		>
			<div class="absolute inset-y-0 left-20 right-20 py-3">
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
							data-page-id={screenshot().pageId}
							class="h-full w-full select-none object-contain drop-shadow-md"
							draggable={false}
						/>
					)}
				</Show>
			</div>

			<Show when={props.stopCount > 0}>
				<button
					type="button"
					class="absolute top-3 left-3 z-10 inline-flex h-6 min-w-14 items-center justify-center gap-1 rounded-full px-2 font-mono text-[11px] tabular-nums shadow-sm transition-colors"
					classList={{
						"bg-blue-600 text-white": active(),
						"bg-white text-gray-500 ring-1 ring-gray-200 hover:text-gray-800":
							!active(),
					}}
					data-testid="step-viewer-position"
					data-active={active() ? "true" : undefined}
					title={
						active()
							? "Stepping through the test with ← →"
							: "Step through the test with ← →"
					}
					onClick={(event) => {
						event.stopPropagation();
						props.onActivate();
					}}
				>
					{active() ? (props.stopIndex ?? 0) + 1 : "–"}/{props.stopCount}
				</button>
			</Show>

			<Show when={props.pages.length > 1}>
				<div
					class="absolute top-3 right-3 z-10 flex max-h-[calc(50%-1.5rem)] w-16 flex-col items-stretch gap-1.5 overflow-y-auto"
					role="group"
					aria-label="Pages"
					data-testid="step-viewer-pages"
					onClick={(event) => event.stopPropagation()}
				>
					<For each={props.pages}>
						{(page) => {
							const pinned = () => props.pinnedPageId === page.pageId;
							const shown = () => shownPageId() === page.pageId;
							return (
								<button
									type="button"
									class="relative flex-shrink-0 overflow-hidden rounded bg-white shadow-sm transition"
									classList={{
										"ring-2 ring-blue-600": shown(),
										"ring-1 ring-gray-300 hover:ring-gray-500": !shown(),
										"opacity-40": !page.hasFrame,
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
										class="block aspect-video w-full object-cover object-top"
										draggable={false}
									/>
									<span class="absolute bottom-0 left-0 rounded-tr bg-gray-900/75 px-1 font-mono text-[9px] leading-[14px] text-white">
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

			<Show when={active() && props.stepAncestry.at(-1)}>
				{(step) => (
					<StepCaption
						step={step()}
						depth={props.stepAncestry.length - 1}
						parents={props.stepAncestry
							.slice(0, -1)
							.filter((span) => span.name === "playwright.test.step")}
						besidePagePicker={props.pages.length > 1}
					/>
				)}
			</Show>

			{navigationButton(-1)}
			{navigationButton(1)}
		</section>
	);
}

/**
 * The step the viewer is on, in full: the steps it is nested in, its title
 * and the locator it acted on. Pinned to the top right corner, beside the page
 * picker when there is one.
 */
function StepCaption(props: {
	step: Span;
	depth: number;
	parents: Span[];
	besidePagePicker: boolean;
}) {
	const color = () =>
		isErrorSpan(props.step)
			? "#dc2626"
			: getStepTimelineColor(props.step, props.depth);

	return (
		<div
			class="pointer-events-none absolute top-3 z-10 w-max max-w-[min(28rem,calc(100%-11rem))] rounded-md border-l-4 bg-white/95 px-3 py-2 shadow-md ring-1 ring-gray-200 backdrop-blur-sm"
			classList={{
				"right-20": props.besidePagePicker,
				"right-3": !props.besidePagePicker,
			}}
			style={{ "border-left-color": color() }}
			data-testid="step-viewer-step"
			data-span-id={props.step.id}
		>
			<Show when={props.parents.length > 0}>
				<div
					class="mb-0.5 text-[11px] leading-snug text-gray-500 break-words"
					data-testid="step-viewer-step-parents"
				>
					<For each={props.parents}>
						{(parent, index) => (
							<>
								<Show when={index() > 0}>
									<span class="mx-1 text-gray-400" aria-hidden="true">
										›
									</span>
								</Show>
								{parent.title}
							</>
						)}
					</For>
				</div>
			</Show>
			<div
				class="text-[13px] font-semibold leading-snug text-gray-900 break-words"
				data-testid="step-viewer-step-title"
			>
				<StepTitleText
					title={props.step.title}
					emphasisColor={`color-mix(in srgb, ${color()} 65%, black)`}
				/>
			</div>
			<Show when={props.step.subtitle}>
				{(subtitle) => (
					<code
						class="mt-1 block rounded-sm bg-gray-100 px-1.5 py-0.5 font-mono text-xs leading-snug text-gray-700 wrap-anywhere"
						data-testid="step-viewer-step-subtitle"
					>
						{subtitle()}
					</code>
				)}
			</Show>
		</div>
	);
}
