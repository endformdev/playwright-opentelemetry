import { children, type JSX, Show, splitProps } from "solid-js";
import type { ScreenshotInfo } from "../trace-info-loader";
import { ScreenshotSkeleton, skeletonPhaseStyle } from "./TraceViewerSkeleton";
import {
	PlayerControlBar,
	type PlayerControlBarProps,
} from "./PlayerControlBar";

export interface StepViewerProps extends Omit<
	PlayerControlBarProps,
	"shownPageId"
> {
	screenshot: ScreenshotInfo | null;
	screenshotsLoading: boolean;
	/** The screenshots have loaded and the test took none */
	noScreenshots: boolean;
	ref: (element: HTMLElement) => void;
	/** The step ruler, at the bottom of the player; absent when left out */
	ruler?: JSX.Element;
	/** Shown in place of the big screenshot, in the filmstrip screen mode */
	filmstrip?: JSX.Element;
}

/**
 * The player: the big screen, one large screenshot of the current moment in
 * the test with nothing over it, or else a filmstrip of every page; then one
 * bar of controls and the step ruler. Left/Right step through the test body's
 * steps, showing each once it has finished; Home/End jump to the first and
 * last step (see useStepViewer for when the keys apply). Clicking the big
 * screen plays and pauses, as in a video player.
 */
export function StepViewer(props: StepViewerProps) {
	// Each read of a JSX prop creates it anew, so resolve it just once.
	const filmstrip = children(() => props.filmstrip);
	const [, controlBarProps] = splitProps(props, [
		"screenshot",
		"screenshotsLoading",
		"noScreenshots",
		"ref",
		"ruler",
		"filmstrip",
	]);
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
						<Show
							when={props.screenshot}
							fallback={
								<Show
									when={props.noScreenshots}
									fallback={
										<Show
											when={!props.screenshotsLoading}
											fallback={
												<div
													role="status"
													aria-label="Loading screenshots"
													class="h-full"
													style={skeletonPhaseStyle()}
												>
													<ScreenshotSkeleton />
												</div>
											}
										>
											<div class="flex h-full items-center justify-center text-sm text-gray-400">
												No screenshot at this time
											</div>
										</Show>
									}
								>
									<div
										class="flex h-full flex-col items-center justify-center gap-1 px-6 text-center"
										data-testid="step-viewer-no-screenshots"
									>
										<p class="text-sm font-medium text-gray-600">
											This test didn't take any screenshots
										</p>
										<p class="max-w-sm text-sm text-gray-400">
											It may have failed before a browser page was opened.
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
