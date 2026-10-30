import { describe, expect, it } from "vitest";
import type { Span } from "../trace-data-loader/exportToSpans";
import { layoutTimelineSpans } from "./timelineLayout";

function span(
	id: string,
	startOffsetMs: number,
	durationMs: number,
	parentId: string | null = null,
): Span {
	return {
		id,
		parentId,
		traceId: "trace",
		name: "playwright.test.step",
		title: `Title ${id}`,
		startOffsetMs,
		durationMs,
		kind: "internal",
		attributes: {},
		serviceName: "playwright-tests",
	};
}

describe("layoutTimelineSpans", () => {
	it("orders each row by start time, then shortest first", () => {
		const layout = layoutTimelineSpans([
			span("root", 0, 100),
			span("late", 60, 10, "root"),
			span("long", 10, 30, "root"),
			span("marker", 10, 0, "root"),
		]);
		expect(layout.rows.map((row) => row.map((bar) => bar.id))).toEqual([
			["root"],
			["marker", "long", "late"],
		]);
	});

	it("keeps each bar's span and indexes bars by id", () => {
		const root = span("root", 0, 100);
		const layout = layoutTimelineSpans([root, span("child", 10, 20, "root")]);
		expect(layout.byId.get("root")?.span).toBe(root);
		expect(layout.byId.get("child")?.row).toBe(1);
		expect(layout.rows[1][0]).toBe(layout.byId.get("child"));
	});

	it("lays out nothing for no spans", () => {
		expect(layoutTimelineSpans([])).toEqual({
			bars: [],
			rows: [],
			byId: new Map(),
		});
	});
});
