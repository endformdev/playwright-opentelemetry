import { describe, expect, it } from "vitest";

import {
	changesScale,
	clampViewport,
	createViewport,
	frameTimeRange,
	getMinVisibleDuration,
	getViewportTransform,
	getVisibleDuration,
	getZoomLevel,
	isFullyZoomedOut,
	interpolateViewportMapping,
	isTimeRangeVisible,
	panViewport,
	resetViewport,
	type TimelineViewport,
	timeToTotalPosition,
	timeToViewportPosition,
	viewportPositionToTime,
	zoomToRange,
	zoomViewport,
} from "./viewport";

describe("createViewport", () => {
	it("creates a viewport spanning the full duration", () => {
		const viewport = createViewport(10000);

		expect(viewport.visibleStartMs).toBe(0);
		expect(viewport.visibleEndMs).toBe(10000);
		expect(viewport.totalDurationMs).toBe(10000);
	});

	it("handles zero duration", () => {
		const viewport = createViewport(0);

		expect(viewport.visibleStartMs).toBe(0);
		expect(viewport.visibleEndMs).toBe(0);
		expect(viewport.totalDurationMs).toBe(0);
	});
});

describe("getVisibleDuration", () => {
	it("returns full duration when not zoomed", () => {
		const viewport = createViewport(5000);
		expect(getVisibleDuration(viewport)).toBe(5000);
	});

	it("returns partial duration when zoomed", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 1000,
			visibleEndMs: 3000,
			totalDurationMs: 5000,
		};
		expect(getVisibleDuration(viewport)).toBe(2000);
	});
});

describe("getZoomLevel", () => {
	it("returns 1 when not zoomed", () => {
		const viewport = createViewport(10000);
		expect(getZoomLevel(viewport)).toBe(1);
	});

	it("returns 2 when showing half the duration", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 0,
			visibleEndMs: 5000,
			totalDurationMs: 10000,
		};
		expect(getZoomLevel(viewport)).toBe(2);
	});

	it("returns 10 when showing 10% of duration", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 0,
			visibleEndMs: 1000,
			totalDurationMs: 10000,
		};
		expect(getZoomLevel(viewport)).toBe(10);
	});
});

describe("timeToViewportPosition", () => {
	it("converts time at viewport start to 0", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 1000,
			visibleEndMs: 3000,
			totalDurationMs: 5000,
		};
		expect(timeToViewportPosition(1000, viewport)).toBe(0);
	});

	it("converts time at viewport end to 1", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 1000,
			visibleEndMs: 3000,
			totalDurationMs: 5000,
		};
		expect(timeToViewportPosition(3000, viewport)).toBe(1);
	});

	it("converts time in middle of viewport to 0.5", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 1000,
			visibleEndMs: 3000,
			totalDurationMs: 5000,
		};
		expect(timeToViewportPosition(2000, viewport)).toBe(0.5);
	});

	it("returns negative for time before viewport", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 1000,
			visibleEndMs: 3000,
			totalDurationMs: 5000,
		};
		expect(timeToViewportPosition(0, viewport)).toBe(-0.5);
	});

	it("returns > 1 for time after viewport", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 1000,
			visibleEndMs: 3000,
			totalDurationMs: 5000,
		};
		expect(timeToViewportPosition(4000, viewport)).toBe(1.5);
	});
});

describe("viewportPositionToTime", () => {
	it("converts position 0 to viewport start time", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 1000,
			visibleEndMs: 3000,
			totalDurationMs: 5000,
		};
		expect(viewportPositionToTime(0, viewport)).toBe(1000);
	});

	it("converts position 1 to viewport end time", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 1000,
			visibleEndMs: 3000,
			totalDurationMs: 5000,
		};
		expect(viewportPositionToTime(1, viewport)).toBe(3000);
	});

	it("is the inverse of timeToViewportPosition", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 1000,
			visibleEndMs: 3000,
			totalDurationMs: 5000,
		};
		const originalTime = 1750;
		const position = timeToViewportPosition(originalTime, viewport);
		const recoveredTime = viewportPositionToTime(position, viewport);
		expect(recoveredTime).toBe(originalTime);
	});
});

describe("timeToTotalPosition", () => {
	it("converts time 0 to position 0", () => {
		const viewport = createViewport(10000);
		expect(timeToTotalPosition(0, viewport)).toBe(0);
	});

	it("converts total duration to position 1", () => {
		const viewport = createViewport(10000);
		expect(timeToTotalPosition(10000, viewport)).toBe(1);
	});

	it("converts mid-point to 0.5", () => {
		const viewport = createViewport(10000);
		expect(timeToTotalPosition(5000, viewport)).toBe(0.5);
	});

	it("works regardless of zoom level", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 2000,
			visibleEndMs: 4000,
			totalDurationMs: 10000,
		};
		// Should still use totalDurationMs, not visible duration
		expect(timeToTotalPosition(5000, viewport)).toBe(0.5);
	});
});

describe("isTimeRangeVisible", () => {
	const viewport: TimelineViewport = {
		visibleStartMs: 1000,
		visibleEndMs: 3000,
		totalDurationMs: 5000,
	};

	it("returns true for range fully inside viewport", () => {
		expect(isTimeRangeVisible(1500, 2500, viewport)).toBe(true);
	});

	it("returns true for range overlapping start", () => {
		expect(isTimeRangeVisible(500, 1500, viewport)).toBe(true);
	});

	it("returns true for range overlapping end", () => {
		expect(isTimeRangeVisible(2500, 3500, viewport)).toBe(true);
	});

	it("returns true for range containing viewport", () => {
		expect(isTimeRangeVisible(0, 5000, viewport)).toBe(true);
	});

	it("returns false for range completely before viewport", () => {
		expect(isTimeRangeVisible(0, 500, viewport)).toBe(false);
	});

	it("returns false for range completely after viewport", () => {
		expect(isTimeRangeVisible(3500, 4500, viewport)).toBe(false);
	});

	it("returns false for range ending exactly at viewport start", () => {
		expect(isTimeRangeVisible(0, 1000, viewport)).toBe(false);
	});

	it("returns false for range starting exactly at viewport end", () => {
		expect(isTimeRangeVisible(3000, 4000, viewport)).toBe(false);
	});
});

describe("isFullyZoomedOut", () => {
	it("returns true for freshly created viewport", () => {
		const viewport = createViewport(10000);
		expect(isFullyZoomedOut(viewport)).toBe(true);
	});

	it("returns false when zoomed in", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 1000,
			visibleEndMs: 5000,
			totalDurationMs: 10000,
		};
		expect(isFullyZoomedOut(viewport)).toBe(false);
	});

	it("returns true when visible range covers full duration", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 0,
			visibleEndMs: 10000,
			totalDurationMs: 10000,
		};
		expect(isFullyZoomedOut(viewport)).toBe(true);
	});
});

describe("clampViewport", () => {
	it("clamps viewport that starts before 0", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: -500,
			visibleEndMs: 1500,
			totalDurationMs: 5000,
		};
		const clamped = clampViewport(viewport);

		expect(clamped.visibleStartMs).toBe(0);
		expect(clamped.visibleEndMs).toBe(2000);
	});

	it("clamps viewport that ends after total duration", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 4000,
			visibleEndMs: 6000,
			totalDurationMs: 5000,
		};
		const clamped = clampViewport(viewport);

		expect(clamped.visibleEndMs).toBe(5000);
		expect(clamped.visibleStartMs).toBe(3000);
	});

	it("preserves viewport within bounds", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 1000,
			visibleEndMs: 3000,
			totalDurationMs: 5000,
		};
		const clamped = clampViewport(viewport);

		expect(clamped.visibleStartMs).toBe(1000);
		expect(clamped.visibleEndMs).toBe(3000);
	});
});

describe("zoomViewport", () => {
	it("zooms in when delta is positive", () => {
		const viewport = createViewport(10000);
		const zoomed = zoomViewport(viewport, 0.5, 0.5); // Zoom in by 50% at center

		expect(getVisibleDuration(zoomed)).toBeLessThan(10000);
	});

	it("zooms out when delta is negative", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 2500,
			visibleEndMs: 7500,
			totalDurationMs: 10000,
		};
		const zoomed = zoomViewport(viewport, 0.5, -0.5);

		expect(getVisibleDuration(zoomed)).toBeGreaterThan(5000);
	});

	it("keeps focal point stationary during zoom", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 2000,
			visibleEndMs: 8000,
			totalDurationMs: 10000,
		};
		const focalPosition = 0.5;
		const focalTimeBefore = viewportPositionToTime(focalPosition, viewport);

		const zoomed = zoomViewport(viewport, focalPosition, 0.5);
		const focalTimeAfter = viewportPositionToTime(focalPosition, zoomed);

		expect(focalTimeAfter).toBeCloseTo(focalTimeBefore, 5);
	});

	it("does not zoom below minimum zoom level (1)", () => {
		const viewport = createViewport(10000);
		const zoomed = zoomViewport(viewport, 0.5, -10); // Try to zoom out a lot

		expect(getZoomLevel(zoomed)).toBeGreaterThanOrEqual(1);
		expect(getVisibleDuration(zoomed)).toBeLessThanOrEqual(10000);
	});

	it("does not zoom above maximum zoom level", () => {
		const viewport = createViewport(10000);

		// Zoom in repeatedly
		let current = viewport;
		for (let i = 0; i < 50; i++) {
			current = zoomViewport(current, 0.5, 0.5);
		}

		expect(getZoomLevel(current)).toBeLessThanOrEqual(100);
	});

	it("clamps result to valid bounds", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 0,
			visibleEndMs: 2000,
			totalDurationMs: 10000,
		};
		// Zoom at left edge
		const zoomed = zoomViewport(viewport, 0, 0.5);

		expect(zoomed.visibleStartMs).toBeGreaterThanOrEqual(0);
		expect(zoomed.visibleEndMs).toBeLessThanOrEqual(10000);
	});
});

describe("panViewport", () => {
	it("pans right when delta is positive", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 1000,
			visibleEndMs: 3000,
			totalDurationMs: 10000,
		};
		const panned = panViewport(viewport, 500);

		expect(panned.visibleStartMs).toBe(1500);
		expect(panned.visibleEndMs).toBe(3500);
	});

	it("pans left when delta is negative", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 1000,
			visibleEndMs: 3000,
			totalDurationMs: 10000,
		};
		const panned = panViewport(viewport, -500);

		expect(panned.visibleStartMs).toBe(500);
		expect(panned.visibleEndMs).toBe(2500);
	});

	it("clamps when panning past start", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 500,
			visibleEndMs: 2500,
			totalDurationMs: 10000,
		};
		const panned = panViewport(viewport, -1000);

		expect(panned.visibleStartMs).toBe(0);
		expect(panned.visibleEndMs).toBe(2000);
	});

	it("clamps when panning past end", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 8000,
			visibleEndMs: 9500,
			totalDurationMs: 10000,
		};
		const panned = panViewport(viewport, 1000);

		expect(panned.visibleEndMs).toBe(10000);
		expect(panned.visibleStartMs).toBe(8500);
	});

	it("preserves visible duration", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 1000,
			visibleEndMs: 3000,
			totalDurationMs: 10000,
		};
		const panned = panViewport(viewport, 500);

		expect(getVisibleDuration(panned)).toBe(getVisibleDuration(viewport));
	});
});

describe("resetViewport", () => {
	it("resets to show full duration", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 2000,
			visibleEndMs: 4000,
			totalDurationMs: 10000,
		};
		const reset = resetViewport(viewport);

		expect(reset.visibleStartMs).toBe(0);
		expect(reset.visibleEndMs).toBe(10000);
		expect(isFullyZoomedOut(reset)).toBe(true);
	});

	it("preserves total duration", () => {
		const viewport: TimelineViewport = {
			visibleStartMs: 2000,
			visibleEndMs: 4000,
			totalDurationMs: 10000,
		};
		const reset = resetViewport(viewport);

		expect(reset.totalDurationMs).toBe(10000);
	});
});

describe("zoomToRange", () => {
	it("zooms to fit the specified range", () => {
		const viewport = createViewport(10000);
		const zoomed = zoomToRange(viewport, 2000, 4000, 0);

		expect(zoomed.visibleStartMs).toBe(2000);
		expect(zoomed.visibleEndMs).toBe(4000);
	});

	it("adds padding around the range", () => {
		const viewport = createViewport(10000);
		const zoomed = zoomToRange(viewport, 2000, 4000, 0.1); // 10% padding

		// Range is 2000ms, 10% = 200ms padding on each side
		expect(zoomed.visibleStartMs).toBe(1800);
		expect(zoomed.visibleEndMs).toBe(4200);
	});

	it("clamps to valid bounds with padding", () => {
		const viewport = createViewport(10000);
		const zoomed = zoomToRange(viewport, 0, 2000, 0.25); // 25% padding

		// Range is 2000ms, 25% = 500ms padding on each side
		// Requested: -500 to 2500, but clamped so start stays at 0
		// Visible duration preserved: 3000ms (2000 + 2*500)
		expect(zoomed.visibleStartMs).toBe(0); // Clamped at 0
		expect(zoomed.visibleEndMs).toBe(3000); // Preserves the 3000ms visible duration
	});
});

describe("getMinVisibleDuration", () => {
	it("uses the maximum wheel zoom for long timelines", () => {
		expect(getMinVisibleDuration(10000)).toBe(100);
	});

	it("never goes below the minimum visible duration", () => {
		expect(getMinVisibleDuration(500)).toBe(10);
	});

	it("never exceeds the timeline itself", () => {
		expect(getMinVisibleDuration(4)).toBe(4);
	});
});

describe("frameTimeRange", () => {
	const view = (visibleStartMs: number, visibleEndMs: number) => ({
		visibleStartMs,
		visibleEndMs,
		totalDurationMs: 10000,
	});

	it("leaves the viewport alone when the range is already in frame", () => {
		const viewport = view(0, 2000);
		expect(frameTimeRange(viewport, 500, 1000)).toBe(viewport);
	});

	it("zooms in and centers when the range is too narrow", () => {
		const framed = frameTimeRange(view(0, 10000), 4000, 4300);

		expect(getVisibleDuration(framed)).toBeCloseTo(2000);
		expect(framed.visibleStartMs).toBeCloseTo(3150);
		expect(framed.visibleEndMs).toBeCloseTo(5150);
	});

	it("zooms out and centers when the range is too wide", () => {
		const framed = frameTimeRange(view(2000, 3000), 2000, 3000);

		expect(getVisibleDuration(framed)).toBeCloseTo(1000 / 0.6);
		expect((framed.visibleStartMs + framed.visibleEndMs) / 2).toBeCloseTo(2500);
	});

	it("pans without zooming when an in-tolerance range is off screen", () => {
		const framed = frameTimeRange(view(0, 2000), 6000, 6500);

		expect(getVisibleDuration(framed)).toBe(2000);
		expect(framed.visibleStartMs).toBe(5250);
		expect(framed.visibleEndMs).toBe(7250);
	});

	it("pans when a range touches the window edge", () => {
		const framed = frameTimeRange(view(0, 2000), 1700, 2000);

		expect(getVisibleDuration(framed)).toBe(2000);
		expect(framed.visibleStartMs).toBe(850);
	});

	it("stops zooming in at the wheel zoom limit", () => {
		const framed = frameTimeRange(view(0, 10000), 5000, 5001);

		expect(getVisibleDuration(framed)).toBeCloseTo(100);
		expect((framed.visibleStartMs + framed.visibleEndMs) / 2).toBeCloseTo(
			5000.5,
		);
	});

	it("keeps a tiny range in place once zoomed in as far as allowed", () => {
		const viewport = view(4950, 5050);
		expect(frameTimeRange(viewport, 5000, 5001)).toBe(viewport);
	});

	it("never zooms out for a tiny range when already past the zoom limit", () => {
		const framed = frameTimeRange(view(4990, 5010), 6000, 6001);

		expect(getVisibleDuration(framed)).toBeCloseTo(20);
		expect((framed.visibleStartMs + framed.visibleEndMs) / 2).toBeCloseTo(
			6000.5,
		);
	});

	it("frames zero-duration ranges", () => {
		const framed = frameTimeRange(view(0, 10000), 3000, 3000);

		expect(getVisibleDuration(framed)).toBeCloseTo(100);
		expect(framed.visibleStartMs).toBeCloseTo(2950);
	});

	it("clamps to the start of the timeline", () => {
		const framed = frameTimeRange(view(0, 10000), 0, 300);

		expect(framed.visibleStartMs).toBe(0);
		expect(getVisibleDuration(framed)).toBeCloseTo(2000);
	});

	it("caps zooming out at the full timeline", () => {
		const viewport = view(0, 10000);
		expect(frameTimeRange(viewport, 0, 10000)).toBe(viewport);
	});
});

describe("getViewportTransform", () => {
	const view = (visibleStartMs: number, visibleEndMs: number) => ({
		visibleStartMs,
		visibleEndMs,
		totalDurationMs: 10000,
	});

	it("draws each time where the old viewport placed it", () => {
		const from = view(1000, 3000);
		const to = view(1500, 2000);
		const { scale, translate } = getViewportTransform(from, to);
		for (const timeMs of [1500, 1750, 2000, 2600]) {
			const laidOut = timeToViewportPosition(timeMs, to);
			expect(scale * laidOut + translate).toBeCloseTo(
				timeToViewportPosition(timeMs, from),
			);
		}
	});

	it("is the identity for an unchanged viewport", () => {
		expect(getViewportTransform(view(0, 500), view(0, 500))).toEqual({
			scale: 1,
			translate: 0,
		});
	});
});

describe("interpolateViewportMapping", () => {
	const from = {
		visibleStartMs: 0,
		visibleEndMs: 4000,
		totalDurationMs: 10000,
	};
	const to = {
		visibleStartMs: 6000,
		visibleEndMs: 7000,
		totalDurationMs: 10000,
	};

	it("starts at from and ends at to", () => {
		expect(interpolateViewportMapping(from, to, 0)).toEqual(from);
		const end = interpolateViewportMapping(from, to, 1);
		expect(end.visibleStartMs).toBeCloseTo(6000);
		expect(end.visibleEndMs).toBeCloseTo(7000);
	});

	it("matches the transform part way through", () => {
		const progress = 0.3;
		const { scale, translate } = getViewportTransform(from, to);
		const shown = interpolateViewportMapping(from, to, progress);
		for (const timeMs of [6000, 6500, 7000]) {
			const laidOut = timeToViewportPosition(timeMs, to);
			const eased =
				(1 - progress) * (scale * laidOut + translate) + progress * laidOut;
			expect(timeToViewportPosition(timeMs, shown)).toBeCloseTo(eased);
		}
	});
});

describe("changesScale", () => {
	const view = (visibleStartMs: number, visibleEndMs: number) => ({
		visibleStartMs,
		visibleEndMs,
		totalDurationMs: 10000,
	});

	it("ignores pans", () => {
		expect(changesScale(view(0, 1000), view(4000, 5000))).toBe(false);
	});

	it("ignores small zooms", () => {
		expect(changesScale(view(0, 1000), view(0, 1100))).toBe(false);
		expect(changesScale(view(0, 1000), view(0, 900))).toBe(false);
	});

	it("detects zooming in and out", () => {
		expect(changesScale(view(0, 1000), view(0, 1200))).toBe(true);
		expect(changesScale(view(0, 1000), view(0, 800))).toBe(true);
	});
});
