import {
	type Accessor,
	batch,
	createContext,
	createMemo,
	createSignal,
	type JSX,
	useContext,
} from "solid-js";
import type { Span } from "../../trace-data-loader/exportToSpans";
import type { ScreenshotInfo } from "../../trace-info-loader";
import { getElementsAtTime, type HoveredElements } from "../getElementsAtTime";
import { timeToViewportPosition, viewportPositionToTime } from "../viewport";
import { useViewportContext } from "./ViewportContext";

export type HoverMode = "hover" | "locked" | "search-override";

/**
 * Who locked the timeline; any new lock or unlock replaces it. `ruler` is a
 * seek or scrub on the step ruler.
 */
export type LockSource = "timeline" | "step-viewer" | "playback" | "ruler";

export type FocusedElementType = "step" | "span";

export interface FocusedElement {
	type: FocusedElementType;
	/** The span's ID */
	id: string;
}

export interface HoverContextValue {
	// Mode
	mode: Accessor<HoverMode>;

	// Position state
	hoverPosition: Accessor<number | null>;
	setHoverPosition: (position: number | null) => void;
	lockedPosition: Accessor<number | null>;
	lockedTimeMs: Accessor<number | null>;
	lockSource: Accessor<LockSource | null>;

	// Actions
	lock: (
		timeMs: number,
		element: FocusedElement | null,
		source?: LockSource,
	) => void;
	unlock: () => void;
	enterSearchOverride: () => void;
	exitSearchOverride: () => void;

	// Element tracking
	hoveredElement: Accessor<FocusedElement | null>;
	setHoveredElement: (element: FocusedElement | null) => void;
	lockedElement: Accessor<FocusedElement | null>;

	// Computed display values (what UI should render)
	displayTimeMs: Accessor<number | null>;
	displayElements: Accessor<HoveredElements | null>;
	displayFocusedElement: Accessor<FocusedElement | null>;
}

const HoverContext = createContext<HoverContextValue>();

export interface HoverProviderProps {
	steps: Accessor<Span[]>;
	spans: Accessor<Span[]>;
	screenshots: Accessor<ScreenshotInfo[]>;
	testStartTimeMs: Accessor<number>;
	children: JSX.Element;
}

export function HoverProvider(props: HoverProviderProps) {
	const { viewport } = useViewportContext();

	const [mode, setMode] = createSignal<HoverMode>("hover");
	const [hoverPosition, setHoverPosition] = createSignal<number | null>(null);
	const [lockedTimeMs, setLockedTimeMs] = createSignal<number | null>(null);
	const [lockSource, setLockSource] = createSignal<LockSource | null>(null);
	const [hoveredElement, setHoveredElement] =
		createSignal<FocusedElement | null>(null, {
			equals: (previous, next) =>
				previous?.type === next?.type && previous?.id === next?.id,
		});
	const [lockedElement, setLockedElement] = createSignal<FocusedElement | null>(
		null,
	);

	const hoverTimeMs = () => {
		const pos = hoverPosition();
		if (pos === null) return null;
		return viewportPositionToTime(pos, viewport());
	};

	const lockedPosition = () => {
		const timeMs = lockedTimeMs();
		if (timeMs === null) return null;
		return timeToViewportPosition(timeMs, viewport());
	};

	const hoveredElements = createMemo((): HoveredElements | null => {
		const timeMs = hoverTimeMs();
		if (timeMs === null) return null;
		return getElementsAtTime(
			timeMs,
			props.steps(),
			props.spans(),
			props.screenshots(),
			props.testStartTimeMs(),
			hoveredElement()?.id,
		);
	});

	const lockedElements = createMemo((): HoveredElements | null => {
		const timeMs = lockedTimeMs();
		if (timeMs === null) return null;
		return getElementsAtTime(
			timeMs,
			props.steps(),
			props.spans(),
			props.screenshots(),
			props.testStartTimeMs(),
			lockedElement()?.id,
		);
	});

	const displayTimeMs = (): number | null => {
		switch (mode()) {
			case "hover":
				return hoverTimeMs();
			case "locked":
				return lockedTimeMs();
			case "search-override":
				return hoverTimeMs();
		}
	};

	const displayElements = (): HoveredElements | null => {
		switch (mode()) {
			case "hover":
			case "search-override":
				return hoveredElements();
			case "locked":
				return lockedElements();
		}
	};

	const displayFocusedElement = (): FocusedElement | null => {
		switch (mode()) {
			case "hover":
			case "search-override":
				return hoveredElement();
			case "locked":
				return lockedElement();
		}
	};

	const lock = (
		timeMs: number,
		element: FocusedElement | null,
		source: LockSource = "timeline",
	) => {
		batch(() => {
			setMode("locked");
			setLockedTimeMs(timeMs);
			setLockedElement(element);
			setLockSource(source);
		});
	};

	const unlock = () => {
		batch(() => {
			setMode("hover");
			setLockedTimeMs(null);
			setLockedElement(null);
			setLockSource(null);
		});
	};

	const enterSearchOverride = () => {
		// Only valid when currently locked
		if (mode() === "locked") {
			setMode("search-override");
		}
	};

	const exitSearchOverride = () => {
		// Return to locked mode
		if (mode() === "search-override") {
			setMode("locked");
		}
	};

	const value: HoverContextValue = {
		mode,
		hoverPosition,
		setHoverPosition,
		lockedPosition,
		lockedTimeMs,
		lockSource,
		lock,
		unlock,
		enterSearchOverride,
		exitSearchOverride,
		hoveredElement,
		setHoveredElement,
		lockedElement,
		displayTimeMs,
		displayElements,
		displayFocusedElement,
	};

	return (
		<HoverContext.Provider value={value}>
			{props.children}
		</HoverContext.Provider>
	);
}

export function useHoverContext(): HoverContextValue {
	const context = useContext(HoverContext);
	if (!context) {
		throw new Error("useHoverContext must be used within a HoverProvider");
	}
	return context;
}
