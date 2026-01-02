import { describe, expect, it } from "vitest";
import type { Span } from "../trace-data-loader/exportToSpans";
import type { ScreenshotInfo } from "../trace-info-loader";
import {
	flattenHoveredSpans,
	getElementsAtTime,
	type HoveredSpan,
} from "./getElementsAtTime";

describe("getElementsAtTime", () => {
	const testStartTimeMs = 1000000; // Unix timestamp in ms

	const createSpan = (
		id: string,
		startOffsetMs: number,
		durationMs: number,
		parentId: string | null = null,
		title = `Span ${id}`,
	): Span => ({
		id,
		parentId,
		traceId: "trace-1",
		name: "test.span",
		title,
		startOffsetMs,
		durationMs,
		kind: "internal",
		attributes: {},
	});

	describe("screenshot selection", () => {
		it("returns null when no screenshots available", () => {
			const result = getElementsAtTime(100, [], [], [], testStartTimeMs);
			expect(result.screenshot).toBeNull();
		});

		it("returns the most recent screenshot before hover time", () => {
			const screenshots: ScreenshotInfo[] = [
				{ timestamp: testStartTimeMs + 50, url: "a.png" },
				{ timestamp: testStartTimeMs + 100, url: "b.png" },
				{ timestamp: testStartTimeMs + 200, url: "c.png" },
			];

			const result = getElementsAtTime(
				150,
				[],
				[],
				screenshots,
				testStartTimeMs,
			);
			expect(result.screenshot?.url).toBe("b.png");
		});

		it("returns null when hover time is before all screenshots (respects causality)", () => {
			const screenshots: ScreenshotInfo[] = [
				{ timestamp: testStartTimeMs + 100, url: "a.png" },
				{ timestamp: testStartTimeMs + 200, url: "b.png" },
			];

			const result = getElementsAtTime(
				50,
				[],
				[],
				screenshots,
				testStartTimeMs,
			);
			// No screenshot should show before any exist - respects causality
			expect(result.screenshot).toBeNull();
		});

		it("returns exact match screenshot", () => {
			const screenshots: ScreenshotInfo[] = [
				{ timestamp: testStartTimeMs + 100, url: "exact.png" },
			];

			const result = getElementsAtTime(
				100,
				[],
				[],
				screenshots,
				testStartTimeMs,
			);
			expect(result.screenshot?.url).toBe("exact.png");
		});
	});

	describe("span filtering", () => {
		it("returns empty arrays when no spans match hover time", () => {
			const spans = [createSpan("1", 0, 50), createSpan("2", 100, 50)];

			const result = getElementsAtTime(75, [], spans, [], testStartTimeMs);
			expect(result.spans).toHaveLength(0);
		});

		it("returns spans that contain the hover time", () => {
			const spans = [
				createSpan("1", 0, 100), // 0-100, contains 50
				createSpan("2", 60, 100), // 60-160, does not contain 50
				createSpan("3", 25, 50), // 25-75, contains 50
			];

			const result = getElementsAtTime(50, [], spans, [], testStartTimeMs);
			const flatSpans = flattenHoveredSpans(result.spans);
			expect(flatSpans).toHaveLength(2);
			expect(flatSpans.map((s) => s.span.id)).toContain("1");
			expect(flatSpans.map((s) => s.span.id)).toContain("3");
		});

		it("includes spans at exact start time", () => {
			const spans = [createSpan("1", 50, 100)];

			const result = getElementsAtTime(50, [], spans, [], testStartTimeMs);
			expect(flattenHoveredSpans(result.spans)).toHaveLength(1);
		});

		it("includes spans at exact end time", () => {
			const spans = [createSpan("1", 0, 50)]; // ends at 50

			const result = getElementsAtTime(50, [], spans, [], testStartTimeMs);
			expect(flattenHoveredSpans(result.spans)).toHaveLength(1);
		});
	});

	describe("hierarchy building", () => {
		it("builds correct parent-child relationships", () => {
			const spans = [
				createSpan("root", 0, 200, null, "Root"),
				createSpan("child1", 10, 100, "root", "Child 1"),
				createSpan("child2", 50, 50, "child1", "Child 2"),
			];

			const result = getElementsAtTime(75, [], spans, [], testStartTimeMs);

			// Root should have one child
			expect(result.spans).toHaveLength(1);
			expect(result.spans[0].span.id).toBe("root");
			expect(result.spans[0].depth).toBe(0);

			// Child1 should be nested under root
			expect(result.spans[0].children).toHaveLength(1);
			expect(result.spans[0].children[0].span.id).toBe("child1");
			expect(result.spans[0].children[0].depth).toBe(1);

			// Child2 should be nested under child1
			expect(result.spans[0].children[0].children).toHaveLength(1);
			expect(result.spans[0].children[0].children[0].span.id).toBe("child2");
			expect(result.spans[0].children[0].children[0].depth).toBe(2);
		});

		it("handles spans where parent is not active", () => {
			const spans = [
				createSpan("parent", 0, 50, null), // ends before hover
				createSpan("child", 60, 50, "parent"), // active at hover, but parent is not
			];

			const result = getElementsAtTime(75, [], spans, [], testStartTimeMs);

			// Child should be promoted to root level since parent is not active
			expect(result.spans).toHaveLength(1);
			expect(result.spans[0].span.id).toBe("child");
			expect(result.spans[0].depth).toBe(0);
		});

		it("handles multiple root spans", () => {
			const spans = [
				createSpan("root1", 0, 100, null),
				createSpan("root2", 10, 100, null),
			];

			const result = getElementsAtTime(50, [], spans, [], testStartTimeMs);
			expect(result.spans).toHaveLength(2);
		});
	});

	describe("steps vs spans separation", () => {
		it("separates steps and spans correctly", () => {
			const steps = [createSpan("step1", 0, 100)];
			const spans = [createSpan("span1", 0, 100)];

			const result = getElementsAtTime(50, steps, spans, [], testStartTimeMs);

			expect(flattenHoveredSpans(result.steps)).toHaveLength(1);
			expect(result.steps[0].span.id).toBe("step1");

			expect(flattenHoveredSpans(result.spans)).toHaveLength(1);
			expect(result.spans[0].span.id).toBe("span1");
		});
	});
});

describe("flattenHoveredSpans", () => {
	const createHoveredSpan = (
		id: string,
		depth: number,
		children: HoveredSpan[] = [],
	): HoveredSpan => ({
		span: {
			id,
			parentId: null,
			traceId: "trace-1",
			name: "test",
			title: `Span ${id}`,
			startOffsetMs: 0,
			durationMs: 100,
			kind: "internal",
			attributes: {},
		},
		depth,
		children,
	});

	it("flattens empty array", () => {
		expect(flattenHoveredSpans([])).toEqual([]);
	});

	it("flattens single node", () => {
		const tree = [createHoveredSpan("1", 0)];
		const flat = flattenHoveredSpans(tree);
		expect(flat).toHaveLength(1);
		expect(flat[0].span.id).toBe("1");
	});

	it("flattens nested tree in depth-first order", () => {
		const tree = [
			createHoveredSpan("1", 0, [
				createHoveredSpan("1.1", 1, [createHoveredSpan("1.1.1", 2)]),
				createHoveredSpan("1.2", 1),
			]),
			createHoveredSpan("2", 0),
		];

		const flat = flattenHoveredSpans(tree);
		expect(flat.map((s) => s.span.id)).toEqual([
			"1",
			"1.1",
			"1.1.1",
			"1.2",
			"2",
		]);
		expect(flat.map((s) => s.depth)).toEqual([0, 1, 2, 1, 0]);
	});
});
