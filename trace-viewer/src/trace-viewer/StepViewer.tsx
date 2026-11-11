import {
	children,
	createSignal,
	type JSX,
	onCleanup,
	Show,
	splitProps,
} from "solid-js";
import type { ScreenshotInfo, TestStatus } from "../trace-info-loader";
import { layOutComparison } from "./comparisonLayout";
import { ScreenshotSkeleton, skeletonPhaseStyle } from "./TraceViewerSkeleton";
import {
	PlayerControlBar,
	type PlayerControlBarProps,
} from "./PlayerControlBar";
import type { ComparisonFrame, ComparisonNote } from "./useTraceComparison";

/** The comparison trace, as the big screen shows it beside the primary's. */
export interface StepViewerComparison {
	label: string;
	/** Loading lasts until the comparison can follow the primary */
	status: "loading" | "failed" | "ready";
	testStatus: TestStatus | null;
	frame: ComparisonFrame;
	/** The comparison has loaded and took no screenshots */
	noScreenshots: boolean;
	note: ComparisonNote | null;
}

export interface StepViewerProps extends Omit<
	PlayerControlBarProps,
	"shownPageId"
> {
	screenshot: ScreenshotInfo | null;
	screenshotsLoading: boolean;
	/** The screenshots have loaded and the test took none */
	noScreenshots: boolean;
	testStatus: TestStatus;
	/** Shown beside the screenshot on the big screen; absent without one */
	comparison: StepViewerComparison | null;
	ref: (element: HTMLElement) => void;
	/** The step ruler, at the bottom of the player; absent when left out */
	ruler?: JSX.Element;
	/** Shown in place of the big screenshot, in the filmstrip screen mode */
	filmstrip?: JSX.Element;
}

const STATUS_LABELS: Record<TestStatus, string> = {
	passed: "Passed",
	failed: "Failed",
	timedOut: "Timed out",
	interrupted: "Interrupted",
	skipped: "Skipped",
};

/** Screenshots are this shape until one loads and tells otherwise. */
const DEFAULT_SCREENSHOT_ASPECT = 16 / 9;
/** Height of a figure's caption with the space under it, in pixels */
const CAPTION_PX = 24;
/** Space between the two figures, in pixels: Tailwind's gap-3 */
const FIGURE_GAP_PX = 12;

/**
 * The player: the big screen, one large screenshot of the current moment in
 * the test with nothing over it, or else a filmstrip of every page; then one
 * bar of controls and the step ruler. Left/Right step through the test body's
 * steps, showing each once it has finished; Home/End jump to the first and
 * last step (see useStepViewer for when the keys apply). Clicking the big
 * screen plays and pauses, as in a video player.
 *
 * With a comparison, the big screen shows its screenshot of the same moment
 * on the left, before this run's on the right, each under a caption.
 */
export function StepViewer(props: StepViewerProps) {
	// Each read of a JSX prop creates it anew, so resolve it just once.
	const filmstrip = children(() => props.filmstrip);
	const [, controlBarProps] = splitProps(props, [
		"screenshot",
		"screenshotsLoading",
		"noScreenshots",
		"testStatus",
		"comparison",
		"ref",
		"ruler",
		"filmstrip",
	]);
	const primaryScreen = (onImageLoad?: (image: HTMLImageElement) => void) => (
		<PrimaryScreen
			screenshot={props.screenshot}
			screenshotsLoading={props.screenshotsLoading}
			noScreenshots={props.noScreenshots}
			onImageLoad={onImageLoad}
		/>
	);
	return (
		<section
			ref={props.ref}
			class="flex h-full flex-col bg-white outline-none"
			aria-label="Step viewer"
			tabIndex={0}
		>
			<Show
				when={filmstrip()}
				fallback={
					<div
						class="relative min-h-0 flex-1 cursor-pointer bg-gray-100 p-3"
						data-testid="step-viewer-screen"
						onClick={props.onTogglePlayback}
					>
						<Show when={props.comparison} fallback={primaryScreen()}>
							{(comparison) => (
								<ComparisonScreens
									comparison={comparison()}
									testStatus={props.testStatus}
									primaryScreen={primaryScreen}
								/>
							)}
						</Show>
					</div>
				}
			>
				<div class="min-h-0 flex-1">{filmstrip()}</div>
			</Show>

			<PlayerControlBar
				{...controlBarProps}
				shownPageId={props.screenshot?.pageId ?? null}
			/>

			{props.ruler}
		</section>
	);
}

/** This run's screenshot, or what stands in for it while there is none. */
function PrimaryScreen(props: {
	screenshot: ScreenshotInfo | null;
	screenshotsLoading: boolean;
	noScreenshots: boolean;
	onImageLoad?: (image: HTMLImageElement) => void;
}) {
	return (
		<Show
			when={props.screenshot}
			fallback={
				<Show
					when={props.noScreenshots}
					fallback={
						<Show
							when={!props.screenshotsLoading}
							fallback={<LoadingScreenshots />}
						>
							<NoScreenshotAtThisTime />
						</Show>
					}
				>
					<div
						class="flex h-full flex-col items-center justify-center gap-1 px-6 text-center"
						data-testid="step-viewer-no-screenshots"
					>
						<p class="text-sm font-medium text-gray-600">
							No screenshots were captured in this test
						</p>
						<p class="max-w-sm text-sm text-gray-400">
							No browser pages were opened that could have captured screenshots.
						</p>
					</div>
				</Show>
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
					onLoad={(event) => props.onImageLoad?.(event.currentTarget)}
				/>
			)}
		</Show>
	);
}

/**
 * The comparison and this run as two captioned figures, side by side or
 * stacked, whichever shows the screenshots larger. Each figure is as large as
 * its screenshot, so the caption sits on the image's own edge.
 */
function ComparisonScreens(props: {
	comparison: StepViewerComparison;
	testStatus: TestStatus;
	primaryScreen: (
		onImageLoad: (image: HTMLImageElement) => void,
	) => JSX.Element;
}) {
	const [size, setSize] = createSignal({ widthPx: 0, heightPx: 0 });
	const [aspect, setAspect] = createSignal(DEFAULT_SCREENSHOT_ASPECT);
	const observer = new ResizeObserver(([entry]) => {
		if (!entry) return;
		const { width, height } = entry.contentRect;
		setSize({ widthPx: width, heightPx: height });
	});
	onCleanup(() => observer.disconnect());
	const choice = () =>
		layOutComparison({
			...size(),
			aspect: aspect(),
			captionPx: CAPTION_PX,
			gapPx: FIGURE_GAP_PX,
		});
	const figureStyle = () => ({ width: `${choice().imageWidthPx}px` });
	const imageStyle = () => ({ height: `${choice().imageHeightPx}px` });
	// Screenshots of one test share a size; this run's image tells it.
	const measureAspect = (image: HTMLImageElement) => {
		if (image.naturalWidth > 0 && image.naturalHeight > 0) {
			setAspect(image.naturalWidth / image.naturalHeight);
		}
	};
	const frame = () => props.comparison.frame;

	return (
		<div
			ref={(element) => observer.observe(element)}
			class="flex h-full items-center justify-center gap-3"
			classList={{ "flex-col": choice().layout === "stacked" }}
			data-testid="step-viewer-comparison-layout"
			data-layout={choice().layout}
		>
			<figure
				class="flex min-w-0 flex-shrink-0 flex-col"
				style={figureStyle()}
				data-testid="step-viewer-comparison"
				data-comparison-time-ms={frame().timeMs ?? undefined}
			>
				<Caption
					label={props.comparison.label}
					testStatus={props.comparison.testStatus}
					note={props.comparison.note}
				/>
				<div style={imageStyle()}>
					<Show
						when={props.comparison.status !== "failed"}
						fallback={<Notice>Couldn't load this trace</Notice>}
					>
						<Show
							when={props.comparison.status === "ready"}
							fallback={<LoadingScreenshots />}
						>
							<Show
								when={frame().screenshot}
								fallback={
									props.comparison.noScreenshots ? (
										<Notice>This run didn't take any screenshots</Notice>
									) : (
										<NoScreenshotAtThisTime />
									)
								}
							>
								{(screenshot) => (
									<img
										src={screenshot().url}
										alt={`Comparison screenshot at ${screenshot().timestamp}`}
										data-screenshot-timestamp={screenshot().timestamp}
										data-page-id={screenshot().pageId}
										class="h-full w-full select-none object-contain drop-shadow-md"
										draggable={false}
									/>
								)}
							</Show>
						</Show>
					</Show>
				</div>
			</figure>
			<figure
				class="flex min-w-0 flex-shrink-0 flex-col"
				style={figureStyle()}
				data-testid="step-viewer-primary"
			>
				<Caption label="This run" testStatus={props.testStatus} note={null} />
				<div style={imageStyle()}>{props.primaryScreen(measureAspect)}</div>
			</figure>
		</div>
	);
}

/** One line over a screenshot: whose it is, how its test ended, and any note. */
function Caption(props: {
	label: string;
	testStatus: TestStatus | null;
	note: ComparisonNote | null;
}) {
	return (
		<figcaption class="flex h-5 min-w-0 flex-shrink-0 items-center gap-2 mb-1 text-xs leading-5">
			<span class="truncate font-medium text-gray-800">{props.label}</span>
			<Show when={props.testStatus}>
				{(status) => (
					<span
						class="flex-shrink-0"
						classList={{
							"text-emerald-700": status() === "passed",
							"text-red-700": status() === "failed" || status() === "timedOut",
							"text-gray-500":
								status() === "skipped" || status() === "interrupted",
						}}
						data-testid="step-viewer-caption-status"
					>
						{STATUS_LABELS[status()]}
					</span>
				)}
			</Show>
			<Show when={props.note}>
				{(note) => (
					<span
						class="ml-auto flex-shrink-0 text-amber-700"
						data-testid="step-viewer-comparison-note"
					>
						{note()}
					</span>
				)}
			</Show>
		</figcaption>
	);
}

function LoadingScreenshots() {
	return (
		<div
			role="status"
			aria-label="Loading screenshots"
			class="h-full"
			style={skeletonPhaseStyle()}
		>
			<ScreenshotSkeleton />
		</div>
	);
}

function NoScreenshotAtThisTime() {
	return <Notice>No screenshot at this time</Notice>;
}

function Notice(props: { children: JSX.Element }) {
	return (
		<div class="flex h-full items-center justify-center px-6 text-center text-sm text-gray-400">
			{props.children}
		</div>
	);
}
