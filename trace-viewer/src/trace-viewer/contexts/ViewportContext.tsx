import {
	type Accessor,
	batch,
	createContext,
	createEffect,
	createMemo,
	createSignal,
	type JSX,
	onCleanup,
	untrack,
	useContext,
} from "solid-js";
import {
	changesScale,
	createViewport,
	getViewportTransform,
	interpolateViewportMapping,
	panViewport,
	resetViewport,
	type TimelineViewport,
	zoomToRange,
	zoomViewport,
} from "../viewport";

/** Duration of animated viewport changes */
export const VIEWPORT_ANIMATION_MS = 180;
/** CSS ease-out cubic */
export const VIEWPORT_ANIMATION_EASING = "cubic-bezier(0.215, 0.61, 0.355, 1)";

/**
 * How long span labels take to come back after a zooming move; 0 snaps them
 * back. Labels are hidden while zooming because the transform stretches them.
 */
export const LABEL_FADE_IN_MS = 100;

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * An animated viewport change. Content is laid out for `to` throughout and
 * drawn where `from` would put it at the start; `clock` is the single source
 * of truth for how far the move has got.
 */
export interface ViewportTransition {
	from: TimelineViewport;
	to: TimelineViewport;
	clock: Animation;
}

export interface SelectionState {
	startPosition: number;
	currentPosition: number;
}

export type ViewportUpdate =
	| TimelineViewport
	| ((shown: TimelineViewport) => TimelineViewport);

export interface ViewportContextValue {
	// State
	/**
	 * Where the timeline is going: lay content out and make decisions (framing,
	 * zoom limits) with this. It differs from the screen only mid-animation.
	 */
	viewport: Accessor<TimelineViewport>;
	durationMs: Accessor<number>;
	testStartTimeMs: Accessor<number>;

	/**
	 * What is on screen right now, mid-animation included. Convert pointer
	 * positions with this. Read on demand; it is not reactive.
	 */
	displayedViewport: () => TimelineViewport;
	/**
	 * What panels must render: the union of both viewports while animating,
	 * so nothing pops in or out mid-animation.
	 */
	renderViewport: Accessor<TimelineViewport>;
	transition: Accessor<ViewportTransition | null>;
	/**
	 * A CSS `transition` value that animates the given properties along with
	 * the current viewport move, for the few elements placed in plot
	 * coordinates outside a viewport layer (time lines, the ruler's window).
	 */
	motionTransition: (...properties: string[]) => string | undefined;

	// Operations
	/**
	 * Changes the viewport directly. Any animation stops where it is first, so
	 * updates apply to what is on screen and nothing snaps.
	 */
	setViewport: (update: ViewportUpdate) => void;
	/**
	 * Moves to a viewport, animating from what is on screen. Elements following
	 * the move animate even when the viewport stays put, so lines placed at a
	 * new time slide there.
	 */
	animateTo: (target: TimelineViewport) => void;
	pan: (deltaMs: number) => void;
	zoom: (focalPosition: number, zoomDelta: number) => void;
	zoomToRange: (startMs: number, endMs: number) => void;
	reset: () => void;

	// Selection (for zoom-drag)
	selectionState: Accessor<SelectionState | null>;
	startSelection: (position: number) => void;
	updateSelection: (position: number) => void;
	endSelection: () => SelectionState | null; // returns final state before clearing
}

const ViewportContext = createContext<ViewportContextValue>();

export interface ViewportProviderProps {
	durationMs: Accessor<number>;
	testStartTimeMs: Accessor<number>;
	children: JSX.Element;
}

export function ViewportProvider(props: ViewportProviderProps) {
	const [viewport, setTargetViewport] = createSignal<TimelineViewport>(
		createViewport(props.durationMs() || 1000),
	);

	const [selectionState, setSelectionState] =
		createSignal<SelectionState | null>(null);

	const [transition, setTransition] = createSignal<ViewportTransition | null>(
		null,
	);

	const displayedViewport = (): TimelineViewport => {
		const active = untrack(transition);
		if (!active) return untrack(viewport);
		const progress = active.clock.effect?.getComputedTiming().progress ?? 1;
		return interpolateViewportMapping(active.from, active.to, progress);
	};

	const stopTransition = () => {
		const active = untrack(transition);
		if (!active) return;
		active.clock.cancel();
		setTransition(null);
	};
	onCleanup(stopTransition);

	const animateTo = (target: TimelineViewport) => {
		batch(() => {
			const from = displayedViewport();
			stopTransition();
			setTargetViewport(target);
			if (prefersReducedMotion()) return;

			// A timer with no target: its eased progress drives every layer.
			const clock = new Animation(
				new KeyframeEffect(null, null, {
					duration: VIEWPORT_ANIMATION_MS,
					easing: VIEWPORT_ANIMATION_EASING,
					fill: "both",
				}),
				document.timeline,
			);
			clock.play();
			setTransition({ from, to: target, clock });
			clock.finished.then(
				() => {
					if (untrack(transition)?.clock === clock) setTransition(null);
				},
				// Cancelled by a newer move or a direct change.
				() => {},
			);
		});
	};

	const setViewport = (update: ViewportUpdate) => {
		batch(() => {
			const shown = displayedViewport();
			stopTransition();
			setTargetViewport(typeof update === "function" ? update(shown) : update);
		});
	};

	const renderViewport = createMemo((): TimelineViewport => {
		const active = transition();
		const current = viewport();
		if (!active) return current;
		return {
			visibleStartMs: Math.min(
				active.from.visibleStartMs,
				current.visibleStartMs,
			),
			visibleEndMs: Math.max(active.from.visibleEndMs, current.visibleEndMs),
			totalDurationMs: current.totalDurationMs,
		};
	});

	const motionTransition = (...properties: string[]) =>
		transition()
			? properties
					.map(
						(property) =>
							`${property} ${VIEWPORT_ANIMATION_MS}ms ${VIEWPORT_ANIMATION_EASING}`,
					)
					.join(", ")
			: undefined;

	// Reset viewport when duration changes
	createMemo(() => {
		const duration = props.durationMs();
		if (duration > 0) {
			setViewport(createViewport(duration));
		}
	});

	const pan = (deltaMs: number) => {
		setViewport((v) => panViewport(v, deltaMs));
	};

	const zoom = (focalPosition: number, zoomDelta: number) => {
		setViewport((v) => zoomViewport(v, focalPosition, zoomDelta));
	};

	const zoomTo = (startMs: number, endMs: number) => {
		setViewport((v) => zoomToRange(v, startMs, endMs));
	};

	const reset = () => {
		setViewport((v) => resetViewport(v));
	};

	const startSelection = (position: number) => {
		setSelectionState({ startPosition: position, currentPosition: position });
	};

	const updateSelection = (position: number) => {
		setSelectionState((prev) => {
			if (!prev) return null;
			return {
				startPosition: prev.startPosition,
				currentPosition: position,
			};
		});
	};

	const endSelection = (): SelectionState | null => {
		const current = selectionState();
		setSelectionState(null);
		return current;
	};

	const value: ViewportContextValue = {
		viewport,
		durationMs: props.durationMs,
		testStartTimeMs: props.testStartTimeMs,
		displayedViewport,
		renderViewport,
		transition,
		motionTransition,
		setViewport,
		animateTo,
		pan,
		zoom,
		zoomToRange: zoomTo,
		reset,
		selectionState,
		startSelection,
		updateSelection,
		endSelection,
	};

	return (
		<ViewportContext.Provider value={value}>
			{props.children}
		</ViewportContext.Provider>
	);
}

export function useViewportContext(): ViewportContextValue {
	const context = useContext(ViewportContext);
	if (!context) {
		throw new Error(
			"useViewportContext must be used within a ViewportProvider",
		);
	}
	return context;
}

/**
 * Makes an element laid out in plot coordinates for the target viewport
 * follow viewport moves, as one compositor-only transform. While a move
 * zooms, the element gets `data-labels-hidden` until movement settles.
 */
export function useViewportLayer(element: () => HTMLElement | undefined): void {
	const { transition } = useViewportContext();
	let animation: Animation | undefined;
	const showLabels = () => element()?.removeAttribute("data-labels-hidden");

	createEffect(() => {
		const active = transition();
		const target = element();
		animation?.cancel();
		animation = undefined;
		if (!target) return;

		const { scale, translate } = active
			? getViewportTransform(active.from, active.to)
			: { scale: 1, translate: 0 };
		if (scale === 1 && translate === 0) {
			showLabels();
			return;
		}

		// Once hidden, labels stay hidden through chained moves.
		if (changesScale(active!.from, active!.to)) {
			target.setAttribute("data-labels-hidden", "");
		}
		animation = target.animate(
			[
				{
					transform: `translateX(${translate * 100}%) scaleX(${scale})`,
					transformOrigin: "0 0",
				},
				{ transform: "none", transformOrigin: "0 0" },
			],
			{ duration: VIEWPORT_ANIMATION_MS, easing: VIEWPORT_ANIMATION_EASING },
		);
		// Only the latest animation finishes; replaced ones are cancelled.
		animation.onfinish = showLabels;
	});

	onCleanup(() => animation?.cancel());
}
