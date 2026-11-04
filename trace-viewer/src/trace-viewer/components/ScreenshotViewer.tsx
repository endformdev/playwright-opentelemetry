import { Show } from "solid-js";
import type { ScreenshotInfo } from "../../trace-info-loader";

export interface ScreenshotViewerProps {
	/**
	 * Screenshot for the current hover or locked time. `null` when there is a
	 * current time but no screenshot at it; `undefined` when there is no
	 * current time at all.
	 */
	screenshot: ScreenshotInfo | null | undefined;
	/** Whether the screenshot is the focused element (e.g. hovered in the filmstrip) */
	focused: boolean;
}

export function ScreenshotViewer(props: ScreenshotViewerProps) {
	return (
		<section
			class="h-full w-full flex items-center justify-center bg-gray-50 p-4 overflow-hidden"
			aria-label="Screenshot viewer"
			data-testid="screenshot-viewer"
		>
			<Show
				when={props.screenshot}
				fallback={
					<div class="text-gray-400 text-sm text-center">
						{props.screenshot === null
							? "No screenshot at this time"
							: "Hover over the timeline to see the screenshot"}
					</div>
				}
			>
				{(screenshot) => (
					<div
						data-screenshot
						data-screenshot-timestamp={screenshot().timestamp}
						data-screenshot-page-id={screenshot().pageId}
						data-focused={props.focused ? "true" : undefined}
						class="h-full w-full flex items-center justify-center"
					>
						<img
							src={screenshot().url}
							alt="Screenshot at current time"
							class="block max-h-full max-w-full object-contain bg-gray-100 rounded-md border-2 transition-colors duration-150"
							classList={{
								"border-blue-500 ring-2 ring-blue-200": props.focused,
								"border-gray-200": !props.focused,
							}}
						/>
					</div>
				)}
			</Show>
		</section>
	);
}
