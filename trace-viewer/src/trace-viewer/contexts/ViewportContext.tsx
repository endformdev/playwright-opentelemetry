import {
	type Accessor,
	createContext,
	createMemo,
	createSignal,
	type JSX,
	type Setter,
	useContext,
} from "solid-js";
import {
	createViewport,
	panViewport,
	resetViewport,
	type TimelineViewport,
	zoomToRange,
	zoomViewport,
} from "../viewport";

export interface SelectionState {
	startPosition: number;
	currentPosition: number;
}

export interface ViewportContextValue {
	// State
	viewport: Accessor<TimelineViewport>;
	durationMs: Accessor<number>;
	testStartTimeMs: Accessor<number>;

	// Operations
	setViewport: Setter<TimelineViewport>;
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
		setViewport,
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
