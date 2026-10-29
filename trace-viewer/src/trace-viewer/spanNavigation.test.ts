import { describe, expect, it } from "vitest";
import { packSpans, type SpanInput } from "./packSpans";
import {
	findSpanNavigationTarget,
	type NavigationPanel,
} from "./spanNavigation";

function span(
	id: string,
	startOffset: number,
	duration: number,
	parentId: string | null = null,
): SpanInput {
	return { id, name: id, startOffset, duration, parentId };
}

function panel(id: string, spans: SpanInput[]): NavigationPanel {
	return { id, spans: packSpans(spans).spans };
}

// Steps:
// row 0: test                                    [0, 1000]
// row 1: before [0,200]   act [250,550]          after [900,1000]
// row 2: fixture [10,100] click [260,300] fill [400,500]   teardown [910,950]
// row 3:                  hover [262,264]
const steps = panel("steps", [
	span("test", 0, 1000),
	span("before", 0, 200, "test"),
	span("fixture", 10, 90, "before"),
	span("act", 250, 300, "test"),
	span("click", 260, 40, "act"),
	span("hover", 262, 2, "click"),
	span("fill", 400, 100, "act"),
	span("after", 900, 100, "test"),
	span("teardown", 910, 40, "after"),
]);

// Browser:
// row 0: doc [240,700]
// row 1: script [245,280] xhr [420,480]
// row 2: image [250,262]
// row 3: early [20,60]   (pushed down, overlaps nothing else on rows 0-2)
const browser = panel("browser", [
	span("doc", 240, 460),
	span("script", 245, 35, "doc"),
	span("xhr", 420, 60, "doc"),
	span("image", 250, 12, "doc"),
	span("early", 20, 40),
]);

const external = panel("external", [span("api", 430, 40)]);

const panels = [steps, browser, external];

describe("findSpanNavigationTarget", () => {
	describe("left and right", () => {
		it("moves to the next bar on the same row", () => {
			expect(findSpanNavigationTarget(panels, "before", "right", 100)).toBe(
				"act",
			);
			expect(findSpanNavigationTarget(panels, "act", "right", 400)).toBe(
				"after",
			);
		});

		it("moves to the previous bar on the same row", () => {
			expect(findSpanNavigationTarget(panels, "after", "left", 950)).toBe(
				"act",
			);
		});

		it("crosses parents while staying on the visual row", () => {
			expect(findSpanNavigationTarget(panels, "fixture", "right", 50)).toBe(
				"click",
			);
			expect(findSpanNavigationTarget(panels, "fill", "right", 450)).toBe(
				"teardown",
			);
		});

		it("stops at the ends of a row", () => {
			expect(findSpanNavigationTarget(panels, "before", "left", 100)).toBe(
				null,
			);
			expect(findSpanNavigationTarget(panels, "teardown", "right", 930)).toBe(
				null,
			);
			expect(findSpanNavigationTarget(panels, "test", "right", 500)).toBe(null);
		});

		it("orders zero-duration spans before longer spans starting together", () => {
			const zeroDuration = panel("steps", [
				span("root", 0, 100),
				span("attach", 10, 0, "root"),
				span("fixture", 10, 20, "root"),
			]);
			expect(
				findSpanNavigationTarget([zeroDuration], "attach", "right", 10),
			).toBe("fixture");
			expect(
				findSpanNavigationTarget([zeroDuration], "fixture", "left", 20),
			).toBe("attach");
		});
	});

	describe("up", () => {
		it("moves to the parent first", () => {
			expect(findSpanNavigationTarget(panels, "click", "up", 280)).toBe("act");
			expect(findSpanNavigationTarget(panels, "act", "up", 400)).toBe("test");
		});

		it("stops at the root of the top panel", () => {
			expect(findSpanNavigationTarget(panels, "test", "up", 500)).toBe(null);
		});

		it("falls back to an overlapping bar in a row above", () => {
			const unrelated = panel("browser", [
				span("first", 0, 100),
				span("second", 50, 100),
			]);
			expect(findSpanNavigationTarget([unrelated], "second", "up", 120)).toBe(
				"first",
			);
		});

		it("enters the panel above at the deepest bar under the time", () => {
			expect(findSpanNavigationTarget(panels, "doc", "up", 263)).toBe("hover");
			expect(findSpanNavigationTarget(panels, "api", "up", 450)).toBe("xhr");
		});

		it("enters the panel above at the nearest bar when nothing is under the time", () => {
			const gap = panel("steps", [span("one", 0, 100), span("two", 300, 100)]);
			const below = panel("browser", [span("request", 220, 20)]);
			expect(findSpanNavigationTarget([gap, below], "request", "up", 230)).toBe(
				"two",
			);
		});
	});

	describe("down", () => {
		it("moves to the child under the time", () => {
			expect(findSpanNavigationTarget(panels, "act", "down", 450)).toBe("fill");
			expect(findSpanNavigationTarget(panels, "test", "down", 950)).toBe(
				"after",
			);
		});

		it("moves to the nearest child when none is under the time", () => {
			expect(findSpanNavigationTarget(panels, "act", "down", 350)).toBe(
				"click",
			);
			expect(findSpanNavigationTarget(panels, "act", "down", 380)).toBe("fill");
		});

		it("clamps the time into the current span", () => {
			expect(findSpanNavigationTarget(panels, "act", "down", 0)).toBe("click");
			expect(findSpanNavigationTarget(panels, "act", "down", 9999)).toBe(
				"fill",
			);
		});

		it("falls back to an overlapping bar in a row below", () => {
			expect(findSpanNavigationTarget(panels, "script", "down", 260)).toBe(
				"image",
			);
		});

		it("crosses into the next panel from a leaf at the shallowest bar under the time", () => {
			expect(findSpanNavigationTarget(panels, "fill", "down", 450)).toBe("doc");
			expect(findSpanNavigationTarget(panels, "xhr", "down", 450)).toBe("api");
			expect(findSpanNavigationTarget(panels, "hover", "down", 263)).toBe(
				"doc",
			);
		});

		it("does not jump to unrelated bars in lower rows", () => {
			// "fixture" has no children and nothing below it overlaps; the browser
			// panel's "early" request is under the time.
			expect(findSpanNavigationTarget(panels, "fixture", "down", 50)).toBe(
				"early",
			);
		});

		it("skips panels with no spans", () => {
			const empty: NavigationPanel = { id: "browser", spans: [] };
			expect(
				findSpanNavigationTarget([steps, empty, external], "fill", "down", 450),
			).toBe("api");
		});

		it("stops at the bottom of the last panel", () => {
			expect(findSpanNavigationTarget(panels, "api", "down", 450)).toBe(null);
		});
	});

	it("returns null for unknown spans", () => {
		expect(findSpanNavigationTarget(panels, "missing", "down", 0)).toBe(null);
	});
});
