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
import { timeToViewportPosition, viewportPositionToTime } from "../viewport";
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
	lockedTimeMs: Accessor<number | null>;

	// Actions
	lock: (timeMs: number, element: FocusedElement | null) => void;
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
				return withFocusedScreenshot(
					hoveredElements(),
					hoveredElement(),
					props.screenshots(),
				);
			case "locked":
				return withFocusedScreenshot(
					lockedElements(),
					lockedElement(),
					props.screenshots(),
				);
			case "search-override":
				return withFocusedScreenshot(
					hoveredElements(),
					hoveredElement(),
					props.screenshots(),
				);
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

	const lock = (timeMs: number, element: FocusedElement | null) => {
		setMode("locked");
		setLockedTimeMs(timeMs);
		setLockedElement(element);
	};

	const unlock = () => {
		setMode("hover");
		setLockedTimeMs(null);
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
		lockedTimeMs,
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

function withFocusedScreenshot(
	elements: HoveredElements | null,
	focused: FocusedElement | null,
	screenshots: ScreenshotInfo[],
): HoveredElements | null {
	if (!elements || focused?.type !== "screenshot") return elements;
	const screenshot =
		screenshots.find((screenshot) => screenshot.url === focused.id) ??
		elements.screenshot;
	return {
		...elements,
		screenshot,
	};
}

export function useHoverContext(): HoverContextValue {
	const context = useContext(HoverContext);
	if (!context) {
		throw new Error("useHoverContext must be used within a HoverProvider");
	}
	return context;
}
