import {
	type Accessor,
	batch,
	createContext,
	createEffect,
	createMemo,
	createSignal,
	type JSX,
	onCleanup,
	type Setter,
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
/** CSS ease-out cubic; `easeOutCubic` below approximates it in JS */
export const VIEWPORT_ANIMATION_EASING = "cubic-bezier(0.215, 0.61, 0.355, 1)";

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * How long span labels take to come back after a zooming move; 0 snaps them
 * back. Labels are hidden while zooming because the transform stretches them.
 */
export const LABEL_FADE_IN_MS = 100;

export function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** An animated viewport change: content is laid out for `to` throughout. */
export interface ViewportTransition {
	from: TimelineViewport;
	to: TimelineViewport;
	startedAt: number;
}

export interface SelectionState {
	startPosition: number;
	currentPosition: number;
}

export interface ViewportContextValue {
	// State
	viewport: Accessor<TimelineViewport>;
	durationMs: Accessor<number>;
	testStartTimeMs: Accessor<number>;

	/**
	 * What panels must render: the union of both viewports while animating,
	 * so nothing pops in or out mid-animation.
	 */
	renderViewport: Accessor<TimelineViewport>;
	viewportTransition: Accessor<ViewportTransition | null>;

	// Operations
	setViewport: Setter<TimelineViewport>;
	/** Changes the viewport, animating from what is currently shown. */
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
	const [viewport, setViewport] = createSignal<TimelineViewport>(
		createViewport(props.durationMs() || 1000),
	);

	const [selectionState, setSelectionState] =
		createSignal<SelectionState | null>(null);

	const [viewportTransition, setViewportTransition] =
		createSignal<ViewportTransition | null>(null);
	let transitionTimer: ReturnType<typeof setTimeout> | undefined;
	const endTransition = () => {
		clearTimeout(transitionTimer);
		setViewportTransition(null);
	};
	onCleanup(() => clearTimeout(transitionTimer));

	const shownViewport = (): TimelineViewport => {
		const transition = viewportTransition();
		if (!transition) return viewport();
		const elapsed =
			(performance.now() - transition.startedAt) / VIEWPORT_ANIMATION_MS;
		return interpolateViewportMapping(
			transition.from,
			transition.to,
			easeOutCubic(Math.min(1, elapsed)),
		);
	};

	const animateTo = (target: TimelineViewport) => {
		const from = untrack(shownViewport);
		if (
			prefersReducedMotion() ||
			(from.visibleStartMs === target.visibleStartMs &&
				from.visibleEndMs === target.visibleEndMs)
		) {
			endTransition();
			setViewport(target);
			return;
		}

		batch(() => {
			setViewport(target);
			setViewportTransition({
				from,
				to: target,
				startedAt: performance.now(),
			});
		});
		// The element animations start on the next frame; let them finish
		// before ending the transition, which would cancel them.
		clearTimeout(transitionTimer);
		transitionTimer = setTimeout(
			() => setViewportTransition(null),
			VIEWPORT_ANIMATION_MS + 50,
		);
	};

	const renderViewport = createMemo((): TimelineViewport => {
		const transition = viewportTransition();
		const current = viewport();
		if (!transition) return current;
		return {
			visibleStartMs: Math.min(
				transition.from.visibleStartMs,
				current.visibleStartMs,
			),
			visibleEndMs: Math.max(
				transition.from.visibleEndMs,
				current.visibleEndMs,
			),
			totalDurationMs: current.totalDurationMs,
		};
	});

	// Direct viewport changes (wheel, drag, reset) take over immediately.
	const setViewportImmediately = ((
		value: Parameters<typeof setViewport>[0],
	) => {
		endTransition();
		return setViewport(value);
	}) as Setter<TimelineViewport>;

	// Reset viewport when duration changes
	createMemo(() => {
		const duration = props.durationMs();
		if (duration > 0) {
			setViewport(createViewport(duration));
		}
	});

	const pan = (deltaMs: number) => {
		setViewportImmediately((v) => panViewport(v, deltaMs));
	};

	const zoom = (focalPosition: number, zoomDelta: number) => {
		setViewportImmediately((v) => zoomViewport(v, focalPosition, zoomDelta));
	};

	const zoomTo = (startMs: number, endMs: number) => {
		setViewportImmediately((v) => zoomToRange(v, startMs, endMs));
	};

	const reset = () => {
		setViewportImmediately((v) => resetViewport(v));
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
		renderViewport,
		viewportTransition,
		setViewport: setViewportImmediately,
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
 * Plays the current viewport transition on an element laid out in timeline
 * plot coordinates, as a single compositor-only transform. While a move
 * zooms, the element gets `data-labels-hidden` until movement settles.
 */
export function useViewportTransitionTransform(
	element: () => HTMLElement | undefined,
): void {
	const { viewportTransition } = useViewportContext();
	let animation: Animation | undefined;
	const showLabels = () => element()?.removeAttribute("data-labels-hidden");

	createEffect(() => {
		const transition = viewportTransition();
		const target = element();
		if (!transition) {
			// Cancelled by a direct viewport change; a finished one is a no-op.
			animation?.cancel();
			animation = undefined;
			showLabels();
			return;
		}
		if (!target) return;

		animation?.cancel();
		// Once hidden, labels stay hidden through chained moves.
		if (changesScale(transition.from, transition.to)) {
			target.setAttribute("data-labels-hidden", "");
		}
		const { scale, translate } = getViewportTransform(
			transition.from,
			transition.to,
		);
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
