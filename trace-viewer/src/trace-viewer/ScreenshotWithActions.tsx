import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { ScreenshotInfo, TraceAction } from "../trace-info-loader";
import type { ActionHoldPhase } from "./actionHolds";
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
/** The radius of the disc around the point input landed on */
const POINT_RADIUS = 12;
/** How far out the ring that closes in on that point starts, while aiming */
const AIM_RING_REACH = 16;
/** How far past the disc the ring spreads once the input has landed */
const LANDED_RING_REACH = 20;

/**
 * A screenshot with what the test did at that moment drawn over it: the
 * point a click landed on, the element it was for, the element a fill typed
 * into. The drawing takes no clicks and is left out wherever it can't be
 * placed, such as on frames that don't say how large the page was.
 *
 * While playback holds on an action it is drawn in two parts. First where it
 * is about to land: the element outlined, a ring closing in on the point.
 * Then the mark itself, with a ring spreading from the point or the element
 * lighting up, to show the input going in.
 */
export function ScreenshotWithActions(props: {
	screenshot: ScreenshotInfo;
	actions: TraceAction[];
	/** The moment the screenshot is on show for, in the screenshots' clock */
	atMs: number;
	/** The hold playback is waiting at, when it is on one of these actions */
	held?: ActionHoldPhase | null;
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
			screenshot.pageId,
			props.atMs,
			props.held,
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
					const hold = () => drawn().overlay.hold;
					// Aiming, the action hasn't happened yet, so nor has it failed.
					const aiming = () => hold()?.phase === "aim";
					const failed = () => drawn().overlay.failed && !aiming();
					/** How far through the hold after the input, or null outside it */
					const landed = () => {
						const current = hold();
						return current?.phase === "landed" ? current.progress : null;
					};
					const color = () => (failed() ? FAILED_COLOR : ACTION_COLOR);
					const hasPointer = () => Boolean(drawn().overlay.point) && !failed();
					// The element is the subject until a point lands on it.
					const boxLeads = () => !hasPointer() || aiming();
					/** The mark comes up while aiming, then fades as time moves on */
					const opacity = () => {
						const current = hold();
						return current?.phase === "aim"
							? 0.4 + 0.6 * current.progress
							: drawn().overlay.opacity;
					};
					/** An element without a point lights up as the input goes in */
					const boxFlash = () => {
						const progress = landed();
						return progress === null || hasPointer() ? 0 : 0.2 * (1 - progress);
					};
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
							data-hold-phase={hold()?.phase}
						>
							<Show when={drawn().overlay.box}>
								{(box) => (
									<g data-testid="action-overlay-box" opacity={opacity()}>
										<rect
											x={box().x}
											y={box().y}
											width={box().width}
											height={box().height}
											rx="3"
											fill="none"
											stroke={HALO_COLOR}
											stroke-width={boxLeads() ? "2.5" : "2"}
											stroke-opacity={boxLeads() ? "0.45" : "0.35"}
										/>
										<rect
											x={box().x}
											y={box().y}
											width={box().width}
											height={box().height}
											rx="3"
											fill={color()}
											fill-opacity={(boxLeads() ? 0.07 : 0.05) + boxFlash()}
											stroke={color()}
											stroke-width={boxLeads() ? "1.5" : "1"}
											stroke-opacity={boxLeads() ? "0.85" : "0.65"}
											stroke-dasharray={failed() ? "6 4" : undefined}
										/>
									</g>
								)}
							</Show>
							<Show when={drawn().overlay.point}>
								{(point) => (
									<g opacity={opacity()}>
										<Show when={drawn().overlay.dragFrom}>
											{(from) => (
												<g data-testid="action-overlay-drag">
													<line
														x1={from().x}
														y1={from().y}
														x2={point().x}
														y2={point().y}
														stroke={HALO_COLOR}
														stroke-width="4"
														stroke-opacity="0.65"
														stroke-linecap="round"
													/>
													<line
														x1={from().x}
														y1={from().y}
														x2={point().x}
														y2={point().y}
														stroke={color()}
														stroke-width="2"
														stroke-linecap="round"
														stroke-dasharray="1 6"
													/>
													<circle
														cx={from().x}
														cy={from().y}
														r="4.5"
														fill={HALO_COLOR}
														stroke={color()}
														stroke-width="1.5"
													/>
												</g>
											)}
										</Show>
										<Show
											when={!aiming()}
											fallback={
												<Ring
													x={point().x}
													y={point().y}
													r={
														POINT_RADIUS +
														AIM_RING_REACH * (1 - (hold()?.progress ?? 1))
													}
													color={color()}
													testId="action-overlay-aim"
												/>
											}
										>
											<Show when={!failed() && landed() !== null}>
												<g opacity={1 - (landed() ?? 1)}>
													<Ring
														x={point().x}
														y={point().y}
														r={
															POINT_RADIUS + LANDED_RING_REACH * (landed() ?? 1)
														}
														color={color()}
														testId="action-overlay-landed"
													/>
												</g>
											</Show>
											<g data-testid="action-overlay-point">
												<circle
													cx={point().x}
													cy={point().y}
													r={POINT_RADIUS}
													fill={color()}
													fill-opacity="0.18"
												/>
												<Show
													when={failed()}
													fallback={
														<circle
															cx={point().x}
															cy={point().y}
															r="4.5"
															fill={color()}
															stroke={HALO_COLOR}
															stroke-width="1.5"
														/>
													}
												>
													<FailedMark x={point().x} y={point().y} />
												</Show>
											</g>
										</Show>
									</g>
								)}
							</Show>
						</svg>
					);
				}}
			</Show>
		</div>
	);
}

/** A ring around the point input lands on, over a halo. */
function Ring(props: {
	x: number;
	y: number;
	r: number;
	color: string;
	testId: string;
}) {
	return (
		<g data-testid={props.testId}>
			<circle
				cx={props.x}
				cy={props.y}
				r={props.r}
				fill="none"
				stroke={HALO_COLOR}
				stroke-width="4"
				stroke-opacity="0.6"
			/>
			<circle
				cx={props.x}
				cy={props.y}
				r={props.r}
				fill="none"
				stroke={props.color}
				stroke-width="2"
			/>
		</g>
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
