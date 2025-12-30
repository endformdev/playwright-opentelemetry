import type { Span } from "../trace-data-loader/exportToSpans";
import type { ScreenshotInfo } from "../trace-info-loader";

/**
 * A span with its depth in the hierarchy and nested children.
 */
export interface HoveredSpan {
	span: Span;
	depth: number;
	children: HoveredSpan[];
}

/**
 * All elements at a specific point in time.
 */
export interface HoveredElements {
	/** The most recent screenshot before or at the hover time */
	screenshot: ScreenshotInfo | null;
	/** Steps active at this time, as a hierarchical tree */
	steps: HoveredSpan[];
	/** Spans active at this time, as a hierarchical tree */
	spans: HoveredSpan[];
}

/**
 * Gets all elements (screenshot, steps, spans) that are active at a specific time.
 *
 * @param timeMs - The time in milliseconds (relative to test start)
 * @param steps - All steps from the trace
 * @param spans - All spans from the trace
 * @param screenshots - All screenshots from the trace
 * @param testStartTimeMs - Test start time as Unix timestamp in ms
 * @returns Elements active at the given time
 */
export function getElementsAtTime(
	timeMs: number,
	steps: Span[],
	spans: Span[],
	screenshots: ScreenshotInfo[],
	testStartTimeMs: number,
): HoveredElements {
	return {
		screenshot: findScreenshotAtTime(timeMs, screenshots, testStartTimeMs),
		steps: findSpansAtTime(timeMs, steps),
		spans: findSpansAtTime(timeMs, spans),
	};
}

/**
 * Finds the most recent screenshot at or before the given time.
 */
function findScreenshotAtTime(
	timeMs: number,
	screenshots: ScreenshotInfo[],
	testStartTimeMs: number,
): ScreenshotInfo | null {
	if (screenshots.length === 0) return null;

	// Convert hover time (relative) to absolute timestamp
	const absoluteTimeMs = testStartTimeMs + timeMs;

	// Find the most recent screenshot at or before this time
	let bestScreenshot: ScreenshotInfo | null = null;

	for (const screenshot of screenshots) {
		if (screenshot.timestamp <= absoluteTimeMs) {
			if (!bestScreenshot || screenshot.timestamp > bestScreenshot.timestamp) {
				bestScreenshot = screenshot;
			}
		}
	}

	// If no screenshot is before the time, return the first one
	if (!bestScreenshot && screenshots.length > 0) {
		bestScreenshot = screenshots[0];
	}

	return bestScreenshot;
}

/**
 * Finds all spans that contain the given time and builds a hierarchical tree.
 */
function findSpansAtTime(timeMs: number, allSpans: Span[]): HoveredSpan[] {
	// Find spans that contain this time
	const activeSpans = allSpans.filter((span) => {
		const startMs = span.startOffsetMs;
		const endMs = span.startOffsetMs + span.durationMs;
		return timeMs >= startMs && timeMs <= endMs;
	});

	if (activeSpans.length === 0) return [];

	// Build a lookup map for active spans
	const activeSpanMap = new Map<string, Span>();
	for (const span of activeSpans) {
		activeSpanMap.set(span.id, span);
	}

	// Build parent-child relationships
	const childrenMap = new Map<string | null, Span[]>();
	for (const span of activeSpans) {
		// Only consider parent if it's also active
		const parentId =
			span.parentId && activeSpanMap.has(span.parentId) ? span.parentId : null;

		const siblings = childrenMap.get(parentId) || [];
		siblings.push(span);
		childrenMap.set(parentId, siblings);
	}

	// Build tree recursively
	function buildTree(parentId: string | null, depth: number): HoveredSpan[] {
		const children = childrenMap.get(parentId) || [];
		// Sort by start time
		children.sort((a, b) => a.startOffsetMs - b.startOffsetMs);

		return children.map((span) => ({
			span,
			depth,
			children: buildTree(span.id, depth + 1),
		}));
	}

	return buildTree(null, 0);
}

/**
 * Flattens a hierarchical tree of HoveredSpan into a flat array,
 * preserving depth information for rendering with indentation.
 */
export function flattenHoveredSpans(tree: HoveredSpan[]): HoveredSpan[] {
	const result: HoveredSpan[] = [];

	function traverse(nodes: HoveredSpan[]) {
		for (const node of nodes) {
			result.push(node);
			traverse(node.children);
		}
	}

	traverse(tree);
	return result;
}
