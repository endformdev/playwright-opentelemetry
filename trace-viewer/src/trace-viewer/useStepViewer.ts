import {
	type Accessor,
	batch,
	createEffect,
	createMemo,
	createResource,
	createSignal,
	untrack,
} from "solid-js";
import type { ScreenshotInfo } from "../trace-info-loader";
import { useHoverContext } from "./contexts/HoverContext";
import {
	findFirstContentfulScreenshot,
	findScreenshotAtTime,
	groupScreenshotsByPage,
} from "./screenshots";
import {
	computeStepRulerSegments,
	getStepSegmentAtTime,
	type StepRulerSegments,
} from "./stepRulerSegments";
import {
	computeStepStops,
	getAdjacentStopIndex,
	type StepStop,
} from "./stepStops";
import type { TestStructure } from "./testStructure";
import type { SpanFocus } from "./useSpanFocus";

export interface StepViewerOptions {
	structure: Accessor<TestStructure>;
	screenshots: Accessor<ScreenshotInfo[]>;
	testStartTimeMs: Accessor<number>;
	/** A time to show frames from for now, leaving the lock where it is */
	peekTimeMs: Accessor<number | null>;
	/** Whether the steps and screenshots have finished loading */
	loaded: Accessor<boolean>;
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
}

export interface StepViewer {
	stops: Accessor<StepStop[]>;
	/** Which step each moment belongs to, as the step ruler draws it */
	segments: Accessor<StepRulerSegments>;
	/** Index of the stop the timeline is locked on, or null */
	currentIndex: Accessor<number | null>;
	/**
	 * Index of the step the counter shows: the stop locked on, else the step
	 * at the time on display, wherever that came from (hovering, a lock,
	 * playback). Null with no time, or before the first step starts.
	 */
	shownIndex: Accessor<number | null>;
	/**
	 * Index of the step the frames on show come from: the step at the peeked
	 * time while the pointer peeks past a lock, else the shown step
	 */
	frameIndex: Accessor<number | null>;
	/** Screenshot to show: the pinned page's, else the latest of any page */
	screenshot: Accessor<ScreenshotInfo | null>;
	/**
	 * The moment the screenshot on show stands for, relative to test start: the
	 * time on display, or the screenshot's own time when there is no frame yet
	 * at that time and a later one is shown instead, like the frame the viewer
	 * opens on. Null with neither.
	 */
	shownTimeMs: Accessor<number | null>;
	/** Whether the frame to show with no time on display is still being found */
	screenshotPending: Accessor<boolean>;
	/** Pages that took screenshots; the picker shows when there are several */
	pages: Accessor<StepViewerPage[]>;
	pinnedPageId: Accessor<string | null>;
	/** Shows one page's screenshots from now on, or null to follow the latest */
	pinPage: (pageId: string | null) => void;
	/** Goes to the stop of the step on display, unless already on a stop */
	activate: () => void;
	navigate: (direction: -1 | 1) => void;
	/** Takes Left/Right/Home/End when stepping applies; true if handled */
	handleKeyDown: (event: KeyboardEvent) => boolean;
	ref: (element: HTMLElement) => void;
}

/**
 * The step viewer walks the test body's steps, stopping just after each one
 * to show what it did (see stepStops.ts). It locks the timeline there like
 * arrow-key span navigation does. The lock's source tells whether the viewer is
 * on a stop: any other lock or unlock hands the selection back to the timeline.
 * It opens paused on the first frame with something on it, on that frame's step.
 */
export function useStepViewer(options: StepViewerOptions): StepViewer {
	const { mode, lock, lockSource, displayTimeMs, displayFocusedElement } =
		useHoverContext();
	let rootElement: HTMLElement | undefined;

	const stops = createMemo(() => computeStepStops(options.structure()));
	const segments = createMemo(() =>
		computeStepRulerSegments(options.structure(), stops()),
	);
	const [selectedIndex, setSelectedIndex] = createSignal<number | null>(null);

	const currentIndex = createMemo(() =>
		lockSource() === "step-viewer" ? selectedIndex() : null,
	);
	// Playback and the step ruler are ways of stepping through too, so the
	// keys that step keep working while they hold the timeline.
	const isStepping = () =>
		currentIndex() !== null ||
		lockSource() === "playback" ||
		lockSource() === "ruler";
	// A hovered or focused step names itself, which time alone can't do for
	// steps running at the same time.
	const indexAtDisplayTime = createMemo(() => {
		const stepId = displayFocusedElement()?.id;
		const index = stops().findIndex((stop) => stop.stepId === stepId);
		if (index !== -1) return index;
		const timeMs = displayTimeMs();
		return timeMs === null
			? null
			: (getStepSegmentAtTime(segments().steps, timeMs)?.stopIndex ?? null);
	});
	const shownIndex = () => currentIndex() ?? indexAtDisplayTime();
	const frameIndex = () => {
		const peekTimeMs = options.peekTimeMs();
		if (peekTimeMs === null) return shownIndex();
		return (
			getStepSegmentAtTime(segments().steps, peekTimeMs)?.stopIndex ?? null
		);
	};

	const screenshotPages = createMemo(() =>
		groupScreenshotsByPage(options.screenshots()),
	);
	const [firstContentfulScreenshot] = createResource(
		options.screenshots,
		(screenshots) => findFirstContentfulScreenshot(screenshots),
	);

	/** When to show frames from, in the screenshots' clock; null with no time */
	const frameTimeMs = () => {
		const timeMs = options.peekTimeMs() ?? displayTimeMs();
		return timeMs === null ? null : options.testStartTimeMs() + timeMs;
	};

	const pages = createMemo((): StepViewerPage[] => {
		const absoluteTimeMs = frameTimeMs();
		return screenshotPages().map(({ pageId, number, screenshots }) => {
			const atTime =
				absoluteTimeMs === null
					? null
					: findScreenshotAtTime(screenshots, absoluteTimeMs);
			return { pageId, number, screenshot: atTime ?? screenshots[0] };
		});
	});

	const [pinnedPageId, setPinnedPageId] = createSignal<string | null>(null);
	const pinnedPage = () => {
		const pageId = pinnedPageId();
		return pageId ? pages().find((page) => page.pageId === pageId) : undefined;
	};
	// With no time on display, or before the first frame, there is nothing on
	// screen yet; show the first frame with something on it.
	const screenshot = () => {
		const pinned = pinnedPage()?.screenshot;
		if (pinned) return pinned;
		const timeMs = frameTimeMs();
		const atTime =
			timeMs === null
				? null
				: findScreenshotAtTime(options.screenshots(), timeMs);
		return atTime ?? firstContentfulScreenshot() ?? null;
	};

	const shownTimeMs = () => {
		const timeMs = options.peekTimeMs() ?? displayTimeMs();
		const shown = screenshot();
		if (!shown) return timeMs;
		const shownAtMs = shown.timestamp - options.testStartTimeMs();
		return timeMs !== null && shownAtMs <= timeMs
			? timeMs
			: Math.max(0, shownAtMs);
	};

	/** Goes to a step, by default at its stop, the moment after it finished. */
	const goToStop = (index: number, atTimeMs?: number) => {
		const stop = stops()[index];
		if (!stop) return;
		const timeMs = atTimeMs ?? stop.timeMs;
		batch(() => {
			setSelectedIndex(index);
			const framed =
				options.canFrame() &&
				options.spanFocus.focusSpan(stop.stepId, {
					at: timeMs,
					source: "step-viewer",
				});
			if (!framed) {
				lock(timeMs, { type: "step", id: stop.stepId }, "step-viewer");
			}
		});
	};

	// Once, and unless a click or key has already chosen where to be.
	let opened = false;
	createEffect(() => {
		if (opened || !options.loaded() || firstContentfulScreenshot.loading) {
			return;
		}
		opened = true;
		untrack(() => {
			const frame = firstContentfulScreenshot();
			if (!frame || !options.enabled() || mode() !== "hover") return;
			const timeMs = Math.max(0, frame.timestamp - options.testStartTimeMs());
			const step = getStepSegmentAtTime(segments().steps, timeMs);
			if (step) goToStop(step.stopIndex, timeMs);
			else lock(timeMs, null, "ruler");
		});
	});

	// Stepping moves on from the step the counter shows.
	const navigate = (direction: -1 | 1) => {
		const index = getAdjacentStopIndex(stops(), shownIndex(), direction);
		if (index !== null) goToStop(index);
	};

	const activate = () => {
		if (currentIndex() === null) goToStop(shownIndex() ?? 0);
	};

	const handleKeyDown = (event: KeyboardEvent) => {
		if (!options.enabled()) return false;
		// Stepping applies while stepping through, with the viewer focused, or
		// with nothing selected yet. A lock from the timeline keeps the keys for
		// span navigation.
		const focused =
			event.target instanceof Node && !!rootElement?.contains(event.target);
		if (!isStepping() && !focused && mode() !== "hover") {
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
		segments,
		currentIndex,
		shownIndex,
		frameIndex,
		screenshot,
		shownTimeMs,
		screenshotPending: () => firstContentfulScreenshot.loading,
		pages,
		pinnedPageId,
		pinPage: setPinnedPageId,
		activate,
		navigate,
		handleKeyDown,
		ref: (element) => {
			rootElement = element;
		},
	};
}
