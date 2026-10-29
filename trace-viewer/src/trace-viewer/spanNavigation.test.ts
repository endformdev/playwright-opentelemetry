import { describe, expect, it } from "vitest";
import { packSpans, type SpanInput } from "./packSpans";
import {
	findSpanNavigationTarget,
	type NavigationDirection,
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

const move = (
	spanId: string,
	direction: NavigationDirection,
	timeMs: number,
	navigationPanels = panels,
) => findSpanNavigationTarget(navigationPanels, spanId, direction, timeMs);

describe("findSpanNavigationTarget", () => {
	describe("left and right", () => {
		it("moves to the next bar on the same row and centers the time line", () => {
			expect(move("before", "right", 100)).toEqual({
				spanId: "act",
				timeMs: 400,
			});
			expect(move("act", "right", 400)).toEqual({
				spanId: "after",
				timeMs: 950,
			});
		});

		it("moves to the previous bar on the same row", () => {
			expect(move("after", "left", 950)).toEqual({
				spanId: "act",
				timeMs: 400,
			});
		});

		it("crosses parents while staying on the visual row", () => {
			expect(move("fixture", "right", 50)?.spanId).toBe("click");
			expect(move("fill", "right", 450)?.spanId).toBe("teardown");
		});

		it("stops at the ends of a row", () => {
			expect(move("before", "left", 100)).toBe(null);
			expect(move("teardown", "right", 930)).toBe(null);
			expect(move("test", "right", 500)).toBe(null);
		});

		it("orders zero-duration bars before longer bars starting together", () => {
			const zeroDuration = panel("steps", [
				span("root", 0, 100),
				span("attach", 10, 0, "root"),
				span("fixture", 10, 20, "root"),
			]);
			expect(move("attach", "right", 10, [zeroDuration])?.spanId).toBe(
				"fixture",
			);
			expect(move("fixture", "left", 20, [zeroDuration])?.spanId).toBe(
				"attach",
			);
		});
	});

	describe("down", () => {
		it("moves to the bar the time line crosses in the row below", () => {
			expect(move("test", "down", 450)).toEqual({
				spanId: "act",
				timeMs: 450,
			});
			expect(move("act", "down", 450)).toEqual({
				spanId: "fill",
				timeMs: 450,
			});
		});

		it("follows the time line rather than the hierarchy", () => {
			// image's parent is doc, but script is directly above it.
			expect(move("doc", "down", 255)?.spanId).toBe("script");
			expect(move("script", "down", 255)?.spanId).toBe("image");
		});

		it("skips rows with nothing under the time line", () => {
			expect(move("fill", "down", 450)?.spanId).toBe("doc");
			expect(move("xhr", "down", 450)?.spanId).toBe("api");
		});

		it("enters the next panel at its topmost bar under the time line", () => {
			expect(move("hover", "down", 263)?.spanId).toBe("doc");
			// Browser rows 0-2 have nothing at 50ms; "early" on row 3 does.
			expect(move("fixture", "down", 50)?.spanId).toBe("early");
		});

		it("skips panels with nothing under the time line", () => {
			const empty: NavigationPanel = { id: "browser", spans: [] };
			expect(move("fill", "down", 450, [steps, empty, external])?.spanId).toBe(
				"api",
			);
		});

		it("stays put when nothing below is under the time line", () => {
			expect(move("script", "down", 270)).toBe(null);
			expect(move("teardown", "down", 930)).toBe(null);
			expect(move("api", "down", 450)).toBe(null);
		});

		it("clamps the time line into the current span", () => {
			expect(move("act", "down", 9999)).toEqual({
				spanId: "doc",
				timeMs: 550,
			});
			expect(move("act", "down", 0)).toEqual({ spanId: "doc", timeMs: 250 });
		});
	});

	describe("up", () => {
		it("moves to the bar the time line crosses in the row above", () => {
			expect(move("fill", "up", 450)).toEqual({ spanId: "act", timeMs: 450 });
			expect(move("act", "up", 450)).toEqual({ spanId: "test", timeMs: 450 });
		});

		it("follows the time line rather than the hierarchy", () => {
			expect(move("image", "up", 255)?.spanId).toBe("script");
		});

		it("skips rows with nothing under the time line", () => {
			// Nothing in browser rows 0-2 at 40ms, so continue into the steps.
			expect(move("early", "up", 40)?.spanId).toBe("fixture");
		});

		it("enters the panel above at its bottommost bar under the time line", () => {
			expect(move("doc", "up", 263)?.spanId).toBe("hover");
			expect(move("api", "up", 450)?.spanId).toBe("xhr");
		});

		it("stops at the top of the first panel", () => {
			expect(move("test", "up", 500)).toBe(null);
		});
	});

	it("makes up and down undo each other", () => {
		const starts: Array<[string, number]> = [
			["hover", 263],
			["fill", 450],
			["image", 255],
			["api", 450],
			["early", 40],
		];
		for (const [spanId, timeMs] of starts) {
			for (const [there, back] of [
				["up", "down"],
				["down", "up"],
			] as const) {
				const target = move(spanId, there, timeMs);
				if (!target) continue;
				expect(move(target.spanId, back, target.timeMs)).toEqual({
					spanId,
					timeMs,
				});
			}
		}
	});

	it("prefers the bar the line passes through over one it only touches", () => {
		const touching = panel("steps", [
			span("root", 0, 200),
			span("first", 0, 100, "root"),
			span("second", 100, 100, "root"),
		]);
		expect(move("root", "down", 100, [touching])?.spanId).toBe("first");
		expect(move("root", "down", 150, [touching])?.spanId).toBe("second");
		// A zero-duration bar on the line only touches it.
		const marker = panel("steps", [
			span("root", 0, 200),
			span("first", 0, 100, "root"),
			span("marker", 100, 0, "root"),
			span("second", 100, 100, "root"),
		]);
		expect(move("root", "down", 100, [marker])?.spanId).toBe("first");
	});

	it("returns null for unknown spans", () => {
		expect(move("missing", "down", 0)).toBe(null);
	});
});
