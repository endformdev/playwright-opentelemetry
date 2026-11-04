import { type JSX, Show, splitProps } from "solid-js";
import type { ScreenshotInfo } from "../trace-info-loader";
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
	ref: (element: HTMLElement) => void;
	/** The step ruler, at the bottom of the player; absent when left out */
	ruler?: JSX.Element;
	/** Shown in place of the big screenshot, in the filmstrip screen mode */
	filmstrip?: JSX.Element;
}

/**
 * The player: the big screen, one large screenshot of the current moment in
 * the test with nothing over it, or else a filmstrip of every page; then one
 * bar of controls and the step ruler. Left/Right
 * step through the test body's steps, showing each once it has finished;
 * Home/End jump to the first and last step (see useStepViewer for when the
 * keys apply).
 */
export function StepViewer(props: StepViewerProps) {
	const [, controlBarProps] = splitProps(props, [
		"screenshot",
		"screenshotsLoading",
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
				when={props.filmstrip}
				fallback={
					<div
						class="relative min-h-0 flex-1 bg-gray-100 p-3"
						data-testid="step-viewer-screen"
						onClick={props.onActivate}
					>
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
				}
			>
				<div class="min-h-0 flex-1">{props.filmstrip}</div>
			</Show>

			<PlayerControlBar
				{...controlBarProps}
				shownPageId={props.screenshot?.pageId ?? null}
			/>

			{props.ruler}
		</section>
	);
}
