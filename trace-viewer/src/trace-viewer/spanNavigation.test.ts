import { describe, expect, it } from "vitest";
import { packSpans, type SpanInput } from "./packSpans";
import {
	findSpanNavigationTarget,
	type NavigationDirection,
	type NavigationPanel,
	type NavigationStep,
	type NavigationTarget,
	navigateWithHistory,
} from "./spanNavigation";
import { createTimelineLayout } from "./timelineLayout";

function span(
	id: string,
	startOffset: number,
	duration: number,
	parentId: string | null = null,
): SpanInput {
	return { id, name: id, startOffset, duration, parentId };
}

function panel(spans: SpanInput[]): NavigationPanel {
	return createTimelineLayout(packSpans(spans));
}

// Steps:
// row 0: test                                    [0, 1000]
// row 1: before [0,200]   act [250,550]          after [900,1000]
// row 2: fixture [10,100] click [260,300] fill [400,500]   teardown [910,950]
// row 3:                  hover [262,264]
const steps = panel([
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
const browser = panel([
	span("doc", 240, 460),
	span("script", 245, 35, "doc"),
	span("xhr", 420, 60, "doc"),
	span("image", 250, 12, "doc"),
	span("early", 20, 40),
]);

const external = panel([span("api", 430, 40)]);

const panels = [steps, browser, external];

const move = (
	spanId: string,
	direction: NavigationDirection,
	timeMs: number,
	navigationPanels = panels,
	slopMs = 0,
) =>
	findSpanNavigationTarget(navigationPanels, spanId, direction, timeMs, slopMs);

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
			const zeroDuration = panel([
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
		it("moves to the bar under the time line in the row below", () => {
			expect(move("test", "down", 450)).toEqual({
				spanId: "act",
				timeMs: 450,
			});
			expect(move("act", "down", 450)).toEqual({
				spanId: "fill",
				timeMs: 450,
			});
		});

		it("follows the layout rather than the hierarchy", () => {
			// image's parent is doc, but script is directly above it.
			expect(move("doc", "down", 255)?.spanId).toBe("script");
			expect(move("script", "down", 255)?.spanId).toBe("image");
		});

		it("picks the bar beneath nearest the line when the line is in a gap", () => {
			// act's line at 360ms falls between click and fill.
			expect(move("act", "down", 360)).toEqual({
				spanId: "fill",
				timeMs: 400,
			});
			expect(move("test", "down", 230)).toEqual({
				spanId: "act",
				timeMs: 250,
			});
			expect(move("script", "down", 270)).toEqual({
				spanId: "image",
				timeMs: 262,
			});
		});

		it("skips rows with nothing beneath the focused bar", () => {
			expect(move("fill", "down", 450)?.spanId).toBe("doc");
			expect(move("xhr", "down", 450)?.spanId).toBe("api");
		});

		it("enters the next panel at its topmost row beneath the focused bar", () => {
			expect(move("hover", "down", 263)?.spanId).toBe("doc");
			// Browser rows 0-2 have nothing beneath fixture; "early" on row 3 does.
			expect(move("fixture", "down", 50)?.spanId).toBe("early");
		});

		it("skips panels with nothing beneath the focused bar", () => {
			const empty = panel([]);
			expect(move("fill", "down", 450, [steps, empty, external])?.spanId).toBe(
				"api",
			);
		});

		it("stays put when nothing is beneath the focused bar", () => {
			expect(move("teardown", "down", 930)).toBe(null);
			expect(move("api", "down", 450)).toBe(null);
		});

		it("widens tiny bars by the slop", () => {
			// row 1: tiny [100,102]  wide [103,200]; row 2: inner [110,150]
			const tiny = panel([
				span("root", 0, 1000),
				span("tiny", 100, 2, "root"),
				span("wide", 103, 97, "root"),
				span("inner", 110, 40, "wide"),
			]);
			expect(move("tiny", "down", 101, [tiny])).toBe(null);
			expect(move("tiny", "down", 101, [tiny], 10)).toEqual({
				spanId: "inner",
				timeMs: 110,
			});
		});

		it("clamps the time line into the current span", () => {
			expect(move("act", "down", 9999)).toEqual({
				spanId: "fill",
				timeMs: 500,
			});
			expect(move("act", "down", 0)).toEqual({ spanId: "click", timeMs: 260 });
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

		it("only looks above the line, not the whole focused bar", () => {
			// hover sits above doc's width, but fill is above the line.
			expect(move("doc", "up", 450)).toEqual({ spanId: "fill", timeMs: 450 });
		});

		it("picks a bar within the slop of the line", () => {
			// row 1: left [100,200]  right [205,300]; row 2: low [203,204]
			const gap = panel([
				span("root", 0, 1000),
				span("left", 100, 100, "root"),
				span("right", 205, 95, "root"),
				span("low", 203, 1, "right"),
			]);
			expect(move("low", "up", 203.5, [gap])?.spanId).toBe("root");
			expect(move("low", "up", 203.5, [gap], 5)).toEqual({
				spanId: "right",
				timeMs: 205,
			});
		});

		it("stops at the top of the first panel", () => {
			expect(move("test", "up", 500)).toBe(null);
		});
	});

	it("returns to the same bar when moving down then up", () => {
		const starts: Array<[string, number]> = [
			["test", 450],
			["test", 230],
			["act", 450],
			["act", 360],
			["hover", 263],
			["fill", 450],
			["doc", 255],
			["script", 270],
			["fixture", 50],
		];
		for (const [spanId, timeMs] of starts) {
			const below = move(spanId, "down", timeMs);
			expect(below, spanId).not.toBe(null);
			expect(move(below!.spanId, "up", below!.timeMs)?.spanId).toBe(spanId);
		}
	});

	it("need not retrace Down when moving Up, since Up follows the line", () => {
		// row 1: tiny [100,102]  wide [103,200]; row 2: inner [110,150]
		const tiny = panel([
			span("root", 0, 1000),
			span("tiny", 100, 2, "root"),
			span("wide", 103, 97, "root"),
			span("inner", 110, 40, "wide"),
		]);
		const below = move("tiny", "down", 101, [tiny], 10);
		expect(below).toEqual({ spanId: "inner", timeMs: 110 });
		// The line moved to 110 to land on inner; wide is under it, not tiny.
		expect(move("inner", "up", 110, [tiny], 10)?.spanId).toBe("wide");
	});

	it("prefers the bar the line passes through over one it only touches", () => {
		const touching = panel([
			span("root", 0, 200),
			span("first", 0, 100, "root"),
			span("second", 100, 100, "root"),
		]);
		expect(move("root", "down", 100, [touching])?.spanId).toBe("first");
		expect(move("root", "down", 150, [touching])?.spanId).toBe("second");
		// A zero-duration bar on the line only touches it.
		const marker = panel([
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

describe("navigateWithHistory", () => {
	// row 1: tiny [100,102]  wide [103,200]; row 2: inner [110,150]
	const tiny = panel([
		span("root", 0, 1000),
		span("tiny", 100, 2, "root"),
		span("wide", 103, 97, "root"),
		span("inner", 110, 40, "wide"),
	]);

	const walk = (
		start: NavigationTarget,
		directions: NavigationDirection[],
		navigationPanels = [tiny],
	) => {
		let current = start;
		let history: NavigationStep[] = [];
		for (const direction of directions) {
			const result = navigateWithHistory(
				navigationPanels,
				history,
				current,
				direction,
				10,
			);
			if (!result) continue;
			current = result.target;
			history = result.history;
		}
		return { current, history };
	};

	it("retraces Down when moving Up, back to the same time", () => {
		expect(walk({ spanId: "tiny", timeMs: 101 }, ["down", "up"])).toEqual({
			current: { spanId: "tiny", timeMs: 101 },
			history: [],
		});
	});

	it("unwinds several moves in reverse", () => {
		// act → fill → teardown → after, back to teardown, fill and act.
		const start = { spanId: "act", timeMs: 450 };
		const { current } = walk(
			start,
			["down", "right", "up", "down", "left", "up"],
			panels,
		);
		expect(current).toEqual(start);
	});

	it("moves geometrically when the last move was not the opposite", () => {
		expect(
			walk({ spanId: "tiny", timeMs: 101 }, ["down", "down"]).current,
		).toEqual({ spanId: "inner", timeMs: 110 });
		expect(
			walk({ spanId: "act", timeMs: 450 }, ["down", "left"], panels).current,
		).toEqual({ spanId: "click", timeMs: 280 });
	});

	it("forgets history once focus moves some other way", () => {
		const { history } = walk({ spanId: "tiny", timeMs: 101 }, ["down"]);
		// Focus was clicked elsewhere on inner, so Up follows the line again.
		expect(
			navigateWithHistory(
				[tiny],
				history,
				{ spanId: "inner", timeMs: 120 },
				"up",
				10,
			)?.target.spanId,
		).toBe("wide");
	});

	it("forgets a step back to a bar that no longer exists", () => {
		const { history } = walk({ spanId: "tiny", timeMs: 101 }, ["down"]);
		const withoutTiny = panel([
			span("root", 0, 1000),
			span("wide", 103, 97, "root"),
			span("inner", 110, 40, "wide"),
		]);
		expect(
			navigateWithHistory(
				[withoutTiny],
				history,
				{ spanId: "inner", timeMs: 110 },
				"up",
				10,
			)?.target.spanId,
		).toBe("wide");
	});

	it("leaves history alone when there is nowhere to move", () => {
		expect(
			navigateWithHistory([tiny], [], { spanId: "root", timeMs: 500 }, "up"),
		).toBe(null);
	});
});
