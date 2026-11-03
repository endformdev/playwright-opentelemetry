import { type Accessor, batch, createMemo, createSignal } from "solid-js";
import type { ScreenshotInfo } from "../trace-info-loader";
import { useHoverContext } from "./contexts/HoverContext";
import { findScreenshotAtTime } from "./screenshots";
import {
	computeStepStops,
	getAdjacentStopIndex,
	getStopIndexAtTime,
	type StepStop,
	type StopPosition,
} from "./stepStops";
import type { TestStructure } from "./testStructure";
import type { SpanFocus } from "./useSpanFocus";

export interface StepViewerOptions {
	structure: Accessor<TestStructure>;
	screenshots: Accessor<ScreenshotInfo[]>;
	testStartTimeMs: Accessor<number>;
	/** Whether the step viewer is on screen and takes its keys */
	enabled: Accessor<boolean>;
	/** Whether stops can frame their step in the steps timeline */
	canFrame: Accessor<boolean>;
	spanFocus: SpanFocus;
}

/** A page (tab or window) that took screenshots, as the page picker shows it. */
export interface StepViewerPage {
	pageId: string;
	/** 1-based, in the order pages first took a screenshot */
	number: number;
	/** The page's frame at the displayed time, or its first frame */
	screenshot: ScreenshotInfo;
	/** False before the page's first frame at the displayed time */
	hasFrame: boolean;
}

export interface StepViewer {
	stops: Accessor<StepStop[]>;
	/** Index of the stop the timeline is locked on, or null */
	currentIndex: Accessor<number | null>;
	currentStop: Accessor<StepStop | null>;
	/** Screenshot to show: the pinned page's, else the latest of any page */
	screenshot: Accessor<ScreenshotInfo | null>;
	/** Pages that took screenshots; the picker shows when there are several */
	pages: Accessor<StepViewerPage[]>;
	pinnedPageId: Accessor<string | null>;
	/** Shows one page's screenshots from now on, or null to follow the latest */
	pinPage: (pageId: string | null) => void;
	/** Goes to the stop at the locked time, unless already on a stop */
	activate: () => void;
	navigate: (direction: -1 | 1) => void;
	goToStop: (index: number) => void;
	/** Takes Left/Right/Home/End when stepping applies; true if handled */
	handleKeyDown: (event: KeyboardEvent) => boolean;
	ref: (element: HTMLElement) => void;
}

/**
 * The step viewer walks the test body's steps, stopping just after each one
 * to show what it did (see stepStops.ts). It locks the timeline there like arrow-key span navigation does. The lock's
 * source tells whether the viewer is on a stop: any other lock or unlock
 * hands the selection back to the timeline.
 */
export function useStepViewer(options: StepViewerOptions): StepViewer {
	const {
		mode,
		lock,
		lockedTimeMs,
		lockSource,
		displayTimeMs,
		displayElements,
	} = useHoverContext();
	let rootElement: HTMLElement | undefined;

	const stops = createMemo(() => computeStepStops(options.structure()));
	const [selectedIndex, setSelectedIndex] = createSignal<number | null>(null);

	const currentIndex = createMemo(() =>
		mode() !== "hover" && lockSource() === "step-viewer"
			? selectedIndex()
			: null,
	);
	const currentStop = () => {
		const index = currentIndex();
		return index === null ? null : (stops()[index] ?? null);
	};

	const screenshotsByPage = createMemo(() => {
		const byPage = new Map<string, ScreenshotInfo[]>();
		const sorted = [...options.screenshots()].sort(
			(a, b) => a.timestamp - b.timestamp,
		);
		for (const screenshot of sorted) {
			const page = byPage.get(screenshot.pageId);
			if (page) page.push(screenshot);
			else byPage.set(screenshot.pageId, [screenshot]);
		}
		return [...byPage.entries()];
	});
	const firstScreenshot = () => screenshotsByPage()[0]?.[1][0] ?? null;

	const pages = createMemo((): StepViewerPage[] => {
		const timeMs = displayTimeMs();
		const absoluteTimeMs =
			timeMs === null ? null : options.testStartTimeMs() + timeMs;
		return screenshotsByPage().map(([pageId, screenshots], index) => {
			const atTime =
				absoluteTimeMs === null
					? null
					: findScreenshotAtTime(screenshots, absoluteTimeMs);
			return {
				pageId,
				number: index + 1,
				screenshot: atTime ?? screenshots[0],
				hasFrame: absoluteTimeMs === null || atTime !== null,
			};
		});
	});

	const [pinnedPageId, setPinnedPageId] = createSignal<string | null>(null);
	const pinnedPage = () => {
		const pageId = pinnedPageId();
		return pageId ? pages().find((page) => page.pageId === pageId) : undefined;
	};
	// Before the first frame there is nothing on screen yet; show the first one.
	const screenshot = () =>
		pinnedPage()?.screenshot ??
		displayElements()?.screenshot ??
		firstScreenshot();

	const goToStop = (index: number) => {
		const stop = stops()[index];
		if (!stop) return;
		batch(() => {
			setSelectedIndex(index);
			const framed =
				options.canFrame() &&
				options.spanFocus.focusSpan(stop.stepId, {
					at: stop.timeMs,
					source: "step-viewer",
				});
			if (!framed) {
				lock(stop.timeMs, { type: "step", id: stop.stepId }, "step-viewer");
			}
		});
	};

	const position = (): StopPosition => {
		const index = currentIndex();
		if (index !== null) return { stopIndex: index };
		const timeMs = mode() === "hover" ? null : lockedTimeMs();
		return timeMs === null ? null : { timeMs };
	};

	const navigate = (direction: -1 | 1) => {
		const index = getAdjacentStopIndex(stops(), position(), direction);
		if (index !== null) goToStop(index);
	};

	const activate = () => {
		if (currentIndex() !== null) return;
		const timeMs = mode() === "hover" ? null : lockedTimeMs();
		const index = timeMs === null ? 0 : getStopIndexAtTime(stops(), timeMs);
		if (index !== null) goToStop(index);
	};

	const handleKeyDown = (event: KeyboardEvent) => {
		if (!options.enabled()) return false;
		// Stepping applies on a stop, with the viewer focused, or with nothing
		// selected yet, where the first press goes to the first stop.
		const focused =
			event.target instanceof Node && !!rootElement?.contains(event.target);
		if (currentIndex() === null && !focused && mode() !== "hover") {
			return false;
		}
		switch (event.key) {
			case "ArrowLeft":
				navigate(-1);
				break;
			case "ArrowRight":
				navigate(1);
				break;
			case "Home":
				goToStop(0);
				break;
			case "End":
				goToStop(stops().length - 1);
				break;
			default:
				return false;
		}
		event.preventDefault();
		return true;
	};

	return {
		stops,
		currentIndex,
		currentStop,
		screenshot,
		pages,
		pinnedPageId,
		pinPage: setPinnedPageId,
		activate,
		navigate,
		goToStop,
		handleKeyDown,
		ref: (element) => {
			rootElement = element;
		},
	};
}
