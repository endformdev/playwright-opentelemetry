import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { ScreenshotInfo, TraceAction } from "../trace-info-loader";
import {
	findActionOverlay,
	placeActionOverlay,
	placeContainedImage,
	type Size,
} from "./actionOverlay";

/** The colour of an action, and of one that failed */
const ACTION_COLOR = "#2563eb";
const FAILED_COLOR = "#dc2626";
/** Drawn under every stroke, so it shows on dark pages and light ones alike */
const HALO_COLOR = "#ffffff";

/**
 * A screenshot with what the test did at that moment drawn over it: the
 * point a click landed on, the element it was for, the element a fill typed
 * into. The drawing takes no clicks and is left out wherever it can't be
 * placed, such as on frames that don't say how large the page was.
 */
export function ScreenshotWithActions(props: {
	screenshot: ScreenshotInfo;
	/** Every screenshot of the trace: which frames exist says which to trust */
	screenshots: ScreenshotInfo[];
	actions: TraceAction[];
	/** The moment the screenshot is on show for, in the screenshots' clock */
	atMs: number;
	alt: string;
	onImageLoad?: (image: HTMLImageElement) => void;
}) {
	const [boxSize, setBoxSize] = createSignal<Size>({ width: 0, height: 0 });
	const observer = new ResizeObserver(([entry]) => {
		if (!entry) return;
		const { width, height } = entry.contentRect;
		setBoxSize({ width, height });
	});
	onCleanup(() => observer.disconnect());

	// The image keeps showing the frame before until the next has loaded, so
	// the drawing goes by the frame that is actually on screen.
	const [loaded, setLoaded] = createSignal<{
		screenshot: ScreenshotInfo;
		size: Size;
	} | null>(null);

	const frameTimesByPage = createMemo(() => {
		const times = new Map<string, number[]>();
		for (const { pageId, timestamp } of props.screenshots) {
			const pageTimes = times.get(pageId);
			if (pageTimes) pageTimes.push(timestamp);
			else times.set(pageId, [timestamp]);
		}
		return times;
	});

	const drawing = createMemo(() => {
		const shown = loaded();
		if (!shown) return null;
		const { screenshot, size } = shown;
		const { viewportWidth, viewportHeight } = screenshot;
		if (viewportWidth === undefined || viewportHeight === undefined) {
			return null;
		}
		const overlay = findActionOverlay(
			props.actions,
			screenshot,
			props.atMs,
			frameTimesByPage().get(screenshot.pageId) ?? [],
		);
		const image = placeContainedImage(boxSize(), size);
		if (!overlay || !image) return null;
		const placed = placeActionOverlay(
			overlay,
			{ width: viewportWidth, height: viewportHeight },
			image,
		);
		return placed ? { image, overlay: placed } : null;
	});

	return (
		<div
			ref={(element) => observer.observe(element)}
			class="relative h-full w-full"
		>
			<img
				src={props.screenshot.url}
				alt={props.alt}
				data-screenshot-timestamp={props.screenshot.timestamp}
				data-page-id={props.screenshot.pageId}
				class="h-full w-full select-none object-contain drop-shadow-md"
				draggable={false}
				onLoad={(event) => {
					const image = event.currentTarget;
					setLoaded({
						screenshot: props.screenshot,
						size: { width: image.naturalWidth, height: image.naturalHeight },
					});
					props.onImageLoad?.(image);
				}}
			/>
			<Show when={drawing()}>
				{(drawn) => {
					const color = () =>
						drawn().overlay.failed ? FAILED_COLOR : ACTION_COLOR;
					return (
						<svg
							class="pointer-events-none absolute overflow-hidden"
							style={{
								left: `${drawn().image.x}px`,
								top: `${drawn().image.y}px`,
								width: `${drawn().image.width}px`,
								height: `${drawn().image.height}px`,
							}}
							viewBox={`0 0 ${drawn().image.width} ${drawn().image.height}`}
							aria-hidden="true"
							data-testid="action-overlay"
							data-method={drawn().overlay.method}
							data-failed={drawn().overlay.failed ? "" : undefined}
						>
							<Show when={drawn().overlay.box}>
								{(box) => (
									<g data-testid="action-overlay-box">
										<rect
											x={box().x}
											y={box().y}
											width={box().width}
											height={box().height}
											rx="3"
											fill="none"
											stroke={HALO_COLOR}
											stroke-width="5"
											stroke-opacity="0.85"
										/>
										<rect
											x={box().x}
											y={box().y}
											width={box().width}
											height={box().height}
											rx="3"
											fill={color()}
											fill-opacity="0.12"
											stroke={color()}
											stroke-width="2"
											stroke-dasharray={
												drawn().overlay.failed ? "6 4" : undefined
											}
										/>
									</g>
								)}
							</Show>
							<Show when={drawn().overlay.point}>
								{(point) => (
									<>
										<Show when={drawn().overlay.dragFrom}>
											{(from) => (
												<g data-testid="action-overlay-drag">
													<line
														x1={from().x}
														y1={from().y}
														x2={point().x}
														y2={point().y}
														stroke={HALO_COLOR}
														stroke-width="6"
														stroke-opacity="0.85"
														stroke-linecap="round"
													/>
													<line
														x1={from().x}
														y1={from().y}
														x2={point().x}
														y2={point().y}
														stroke={color()}
														stroke-width="2.5"
														stroke-linecap="round"
														stroke-dasharray="1 6"
													/>
													<circle
														cx={from().x}
														cy={from().y}
														r="5"
														fill={HALO_COLOR}
														stroke={color()}
														stroke-width="2"
													/>
												</g>
											)}
										</Show>
										<g data-testid="action-overlay-point">
											<circle
												cx={point().x}
												cy={point().y}
												r="14"
												fill={color()}
												fill-opacity="0.22"
											/>
											<Show
												when={drawn().overlay.failed}
												fallback={
													<circle
														cx={point().x}
														cy={point().y}
														r="5"
														fill={color()}
														stroke={HALO_COLOR}
														stroke-width="2"
													/>
												}
											>
												<FailedMark x={point().x} y={point().y} />
											</Show>
										</g>
									</>
								)}
							</Show>
						</svg>
					);
				}}
			</Show>
		</div>
	);
}

/** A cross where input was aimed but didn't get through. */
function FailedMark(props: { x: number; y: number }) {
	const arm = 5;
	const path = () =>
		`M${props.x - arm} ${props.y - arm}L${props.x + arm} ${props.y + arm}` +
		`M${props.x + arm} ${props.y - arm}L${props.x - arm} ${props.y + arm}`;
	return (
		<>
			<path
				d={path()}
				stroke={HALO_COLOR}
				stroke-width="6"
				stroke-linecap="round"
			/>
			<path
				d={path()}
				stroke={FAILED_COLOR}
				stroke-width="2.5"
				stroke-linecap="round"
			/>
		</>
	);
}
