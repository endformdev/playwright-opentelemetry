import {
	type Accessor,
	createContext,
	createMemo,
	createSignal,
	type JSX,
	useContext,
} from "solid-js";
import type { Span } from "../../trace-data-loader/exportToSpans";
import type { ScreenshotInfo } from "../../trace-info-loader";
import { getElementsAtTime, type HoveredElements } from "../getElementsAtTime";
import { viewportPositionToTime } from "../viewport";
import { useViewportContext } from "./ViewportContext";

export type HoverMode = "hover" | "locked" | "search-override";

export type FocusedElementType = "screenshot" | "step" | "span";

export interface FocusedElement {
	type: FocusedElementType;
	id: string; // span ID for steps/spans, or screenshot URL for screenshots
}

export interface HoverContextValue {
	// Mode
	mode: Accessor<HoverMode>;

	// Position state
	hoverPosition: Accessor<number | null>;
	setHoverPosition: (position: number | null) => void;
	lockedPosition: Accessor<number | null>;

	// Actions
	lock: (position: number, element: FocusedElement | null) => void;
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
	screenshots: ScreenshotInfo[];
	testStartTimeMs: Accessor<number>;
	children: JSX.Element;
}

export function HoverProvider(props: HoverProviderProps) {
	const { viewport } = useViewportContext();

	const [mode, setMode] = createSignal<HoverMode>("hover");
	const [hoverPosition, setHoverPosition] = createSignal<number | null>(null);
	const [lockedPosition, setLockedPosition] = createSignal<number | null>(null);
	const [hoveredElement, setHoveredElement] =
		createSignal<FocusedElement | null>(null);
	const [lockedElement, setLockedElement] = createSignal<FocusedElement | null>(
		null,
	);

	const hoverTimeMs = () => {
		const pos = hoverPosition();
		if (pos === null) return null;
		return viewportPositionToTime(pos, viewport());
	};

	const lockedTimeMs = () => {
		const pos = lockedPosition();
		if (pos === null) return null;
		return viewportPositionToTime(pos, viewport());
	};

	const hoveredElements = createMemo((): HoveredElements | null => {
		const timeMs = hoverTimeMs();
		if (timeMs === null) return null;
		return getElementsAtTime(
			timeMs,
			props.steps(),
			props.spans(),
			props.screenshots,
			props.testStartTimeMs(),
		);
	});

	const lockedElements = createMemo((): HoveredElements | null => {
		const timeMs = lockedTimeMs();
		if (timeMs === null) return null;
		return getElementsAtTime(
			timeMs,
			props.steps(),
			props.spans(),
			props.screenshots,
			props.testStartTimeMs(),
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
				return hoveredElements();
			case "locked":
				return lockedElements();
			case "search-override":
				return hoveredElements();
		}
	};

	const displayFocusedElement = (): FocusedElement | null => {
		switch (mode()) {
			case "hover":
				return hoveredElement();
			case "locked":
				return lockedElement();
			case "search-override":
				return hoveredElement();
		}
	};

	const lock = (position: number, element: FocusedElement | null) => {
		setMode("locked");
		setLockedPosition(position);
		setLockedElement(element);
	};

	const unlock = () => {
		setMode("hover");
		setLockedPosition(null);
		setLockedElement(null);
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
