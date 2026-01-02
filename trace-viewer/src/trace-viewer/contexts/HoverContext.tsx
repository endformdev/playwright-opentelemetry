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

const LOCK_WINDOW_PX = 50;

export type FocusedElementType = "screenshot" | "step" | "span";

export interface FocusedElement {
	type: FocusedElementType;
	id: string; // span ID for steps/spans, or screenshot URL for screenshots
}

export interface HoverContextValue {
	// Raw position state
	hoverPosition: Accessor<number | null>;
	setHoverPosition: (position: number | null) => void;

	// Lock state
	lockedPosition: Accessor<number | null>;
	lock: (position: number, element: FocusedElement | null) => void;
	unlock: () => void;

	// Element tracking (which specific element is hovered)
	hoveredElement: Accessor<FocusedElement | null>;
	setHoveredElement: (element: FocusedElement | null) => void;
	lockedElement: Accessor<FocusedElement | null>;

	// Computed display values (what UI should show)
	displayTimeMs: Accessor<number | null>;
	displayElements: Accessor<HoveredElements | null>;
	displayFocusedElement: Accessor<FocusedElement | null>;
	isWithinLockWindow: Accessor<boolean>;

	// For lock window calculation
	setPanelWidth: (width: number) => void;
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

	const [hoverPosition, setHoverPosition] = createSignal<number | null>(null);
	const [lockedPosition, setLockedPosition] = createSignal<number | null>(null);
	const [hoveredElement, setHoveredElement] =
		createSignal<FocusedElement | null>(null);
	const [lockedElement, setLockedElement] = createSignal<FocusedElement | null>(
		null,
	);
	const [panelWidth, setPanelWidth] = createSignal<number>(0);

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

	const isWithinLockWindow = () => {
		const locked = lockedPosition();
		const hover = hoverPosition();
		const width = panelWidth();
		if (locked === null || hover === null || width === 0) return false;

		const lockedPx = locked * width;
		const hoverPx = hover * width;
		return Math.abs(hoverPx - lockedPx) <= LOCK_WINDOW_PX;
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

	// Determine what to display in details panel and header:
	// - If locked and (no hover OR within lock window): show locked data
	// - If locked and outside lock window: show hover data
	// - If not locked: show hover data
	const displayElements = (): HoveredElements | null => {
		if (lockedPosition() !== null) {
			if (hoverPosition() === null || isWithinLockWindow()) {
				return lockedElements();
			}
			return hoveredElements();
		}
		return hoveredElements();
	};

	const displayTimeMs = (): number | null => {
		if (lockedPosition() !== null) {
			if (hoverPosition() === null || isWithinLockWindow()) {
				return lockedTimeMs();
			}
			return hoverTimeMs();
		}
		return hoverTimeMs();
	};

	// Determine which element to scroll to in the details panel.
	// The key behavior: when locked, if hovering over a specific element, scroll to it;
	// otherwise (no hover or generic hover), scroll to the locked element.
	const displayFocusedElement = (): FocusedElement | null => {
		if (lockedPosition() !== null) {
			if (hoverPosition() === null || isWithinLockWindow()) {
				// Mouse left the panel or is within lock window - scroll to locked element
				return lockedElement();
			}
			// Mouse is outside lock window - scroll to hovered element if any,
			// otherwise stay on locked element
			return hoveredElement() ?? lockedElement();
		}

		return hoveredElement();
	};

	const lock = (position: number, element: FocusedElement | null) => {
		setLockedPosition(position);
		setLockedElement(element);
	};

	const unlock = () => {
		setLockedPosition(null);
		setLockedElement(null);
	};

	const value: HoverContextValue = {
		hoverPosition,
		setHoverPosition,
		lockedPosition,
		lock,
		unlock,
		hoveredElement,
		setHoveredElement,
		lockedElement,
		displayTimeMs,
		displayElements,
		displayFocusedElement,
		isWithinLockWindow,
		setPanelWidth,
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
