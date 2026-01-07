import { describe, expect, it } from "vitest";
import {
	findAvailableRow,
	flattenSpanTree,
	packSpans,
	spansOverlap,
} from "./packSpans";

describe("spansOverlap", () => {
	it("returns true for overlapping spans", () => {
		expect(
			spansOverlap(
				{ startOffset: 0, duration: 100 },
				{ startOffset: 50, duration: 100 },
			),
		).toBe(true);
	});

	it("returns true for nested spans", () => {
		expect(
			spansOverlap(
				{ startOffset: 0, duration: 200 },
				{ startOffset: 50, duration: 50 },
			),
		).toBe(true);
	});

	it("returns true for adjacent spans (no gap) due to 2ms minimum gap requirement", () => {
		expect(
			spansOverlap(
				{ startOffset: 0, duration: 100 },
				{ startOffset: 100, duration: 100 },
			),
		).toBe(true);
	});

	it("returns true for spans less than 2ms apart", () => {
		expect(
			spansOverlap(
				{ startOffset: 0, duration: 100 },
				{ startOffset: 101, duration: 100 },
			),
		).toBe(true);
	});

	it("returns false for spans exactly 2ms apart", () => {
		expect(
			spansOverlap(
				{ startOffset: 0, duration: 100 },
				{ startOffset: 102, duration: 100 },
			),
		).toBe(false);
	});

	it("returns false for non-overlapping spans with large gap", () => {
		expect(
			spansOverlap(
				{ startOffset: 0, duration: 100 },
				{ startOffset: 200, duration: 100 },
			),
		).toBe(false);
	});

	it("returns false for spans in reverse order with sufficient gap", () => {
		expect(
			spansOverlap(
				{ startOffset: 200, duration: 100 },
				{ startOffset: 0, duration: 100 },
			),
		).toBe(false);
	});

	it("returns true for spans in reverse order within 2ms", () => {
		expect(
			spansOverlap(
				{ startOffset: 101, duration: 100 },
				{ startOffset: 0, duration: 100 },
			),
		).toBe(true);
	});
});

describe("findAvailableRow", () => {
	it("returns minRow when no rows exist", () => {
		const row = findAvailableRow({ startOffset: 0, duration: 100 }, [], 0);
		expect(row).toBe(0);
	});

	it("returns minRow when row is available", () => {
		const rows = [[{ startOffset: 200, duration: 100 }]];
		const row = findAvailableRow({ startOffset: 0, duration: 100 }, rows, 0);
		expect(row).toBe(0);
	});

	it("returns next row when minRow has overlap", () => {
		const rows = [[{ startOffset: 0, duration: 200 }]];
		const row = findAvailableRow({ startOffset: 100, duration: 100 }, rows, 0);
		expect(row).toBe(1);
	});

	it("respects minRow constraint", () => {
		const rows = [[{ startOffset: 200, duration: 100 }]]; // Row 0 is free at offset 0
		const row = findAvailableRow({ startOffset: 0, duration: 100 }, rows, 1);
		expect(row).toBe(1); // Still returns 1 due to minRow constraint
	});

	it("finds first available row with multiple occupied rows", () => {
		const rows = [
			[{ startOffset: 0, duration: 300 }],
			[{ startOffset: 50, duration: 200 }],
			[{ startOffset: 100, duration: 100 }],
		];
		// Span at 252-352: row 0 ends at 300 (overlaps), row 1 ends at 250 (2ms gap - ok), row 2 ends at 200 (52ms gap - ok)
		// First available is row 1
		const row = findAvailableRow({ startOffset: 252, duration: 100 }, rows, 0);
		expect(row).toBe(1);
	});
});

describe("packSpans", () => {
	it("returns empty result for empty input", () => {
		const result = packSpans([]);
		expect(result.spans).toEqual([]);
		expect(result.totalRows).toBe(0);
	});

	it("places single span on row 0", () => {
		const result = packSpans([
			{ id: "a", name: "A", startOffset: 0, duration: 100, parentId: null },
		]);
		expect(result.spans[0].row).toBe(0);
		expect(result.totalRows).toBe(1);
	});

	it("places non-overlapping spans on same row", () => {
		const result = packSpans([
			{ id: "a", name: "A", startOffset: 0, duration: 100, parentId: null },
			{ id: "b", name: "B", startOffset: 200, duration: 100, parentId: null },
		]);
		expect(result.spans[0].row).toBe(0);
		expect(result.spans[1].row).toBe(0);
		expect(result.totalRows).toBe(1);
	});

	it("places overlapping spans on different rows", () => {
		const result = packSpans([
			{ id: "a", name: "A", startOffset: 0, duration: 200, parentId: null },
			{ id: "b", name: "B", startOffset: 100, duration: 200, parentId: null },
		]);
		expect(result.spans[0].row).toBe(0);
		expect(result.spans[1].row).toBe(1);
		expect(result.totalRows).toBe(2);
	});

	it("places child below parent even when non-overlapping", () => {
		const result = packSpans([
			{
				id: "parent",
				name: "Parent",
				startOffset: 0,
				duration: 100,
				parentId: null,
			},
			{
				id: "child",
				name: "Child",
				startOffset: 200,
				duration: 100,
				parentId: "parent",
			},
		]);
		expect(result.spans[0].row).toBe(0); // parent
		expect(result.spans[1].row).toBe(1); // child must be below parent
		expect(result.totalRows).toBe(2);
	});

	it("places grandchild below child", () => {
		const result = packSpans([
			{
				id: "root",
				name: "Root",
				startOffset: 0,
				duration: 500,
				parentId: null,
			},
			{
				id: "child",
				name: "Child",
				startOffset: 100,
				duration: 300,
				parentId: "root",
			},
			{
				id: "grandchild",
				name: "Grandchild",
				startOffset: 150,
				duration: 100,
				parentId: "child",
			},
		]);
		expect(result.spans[0].row).toBe(0); // root
		expect(result.spans[1].row).toBe(1); // child
		expect(result.spans[2].row).toBe(2); // grandchild
		expect(result.totalRows).toBe(3);
	});

	it("packs siblings on same row when non-overlapping", () => {
		const result = packSpans([
			{
				id: "parent",
				name: "Parent",
				startOffset: 0,
				duration: 500,
				parentId: null,
			},
			{
				id: "child1",
				name: "Child 1",
				startOffset: 50,
				duration: 100,
				parentId: "parent",
			},
			{
				id: "child2",
				name: "Child 2",
				startOffset: 200,
				duration: 100,
				parentId: "parent",
			},
		]);
		expect(result.spans[0].row).toBe(0); // parent
		expect(result.spans[1].row).toBe(1); // child1
		expect(result.spans[2].row).toBe(1); // child2 can share row with child1
		expect(result.totalRows).toBe(2);
	});

	it("respects relative ordering - first span gets priority", () => {
		const result = packSpans([
			{ id: "a", name: "A", startOffset: 100, duration: 100, parentId: null },
			{ id: "b", name: "B", startOffset: 0, duration: 300, parentId: null },
		]);
		// 'a' comes first in input, so it gets row 0
		// 'b' overlaps with 'a', so it goes to row 1
		expect(result.spans[0].row).toBe(0); // a
		expect(result.spans[1].row).toBe(1); // b
	});

	it("handles complex hierarchy with compaction", () => {
		const result = packSpans([
			{
				id: "http1",
				name: "HTTP 1",
				startOffset: 0,
				duration: 150,
				parentId: null,
			},
			{
				id: "db1",
				name: "DB 1",
				startOffset: 20,
				duration: 50,
				parentId: "http1",
			},
			{
				id: "http2",
				name: "HTTP 2",
				startOffset: 200,
				duration: 150,
				parentId: null,
			},
			{
				id: "db2",
				name: "DB 2",
				startOffset: 220,
				duration: 50,
				parentId: "http2",
			},
		]);
		// http1 and http2 don't overlap -> same row (0)
		// db1 and db2 don't overlap and both need row >= 1 -> same row (1)
		expect(result.spans[0].row).toBe(0); // http1
		expect(result.spans[1].row).toBe(1); // db1
		expect(result.spans[2].row).toBe(0); // http2
		expect(result.spans[3].row).toBe(1); // db2
		expect(result.totalRows).toBe(2);
	});
});

describe("flattenSpanTree", () => {
	it("flattens single span", () => {
		const tree = [
			{ id: "a", name: "A", startOffset: 0, duration: 100, children: [] },
		];
		const flat = flattenSpanTree(tree);
		expect(flat).toEqual([
			{ id: "a", name: "A", startOffset: 0, duration: 100, parentId: null },
		]);
	});

	it("flattens tree with children in pre-order", () => {
		const tree = [
			{
				id: "parent",
				name: "Parent",
				startOffset: 0,
				duration: 500,
				children: [
					{
						id: "child1",
						name: "Child 1",
						startOffset: 50,
						duration: 100,
						children: [],
					},
					{
						id: "child2",
						name: "Child 2",
						startOffset: 200,
						duration: 100,
						children: [],
					},
				],
			},
		];
		const flat = flattenSpanTree(tree);
		expect(flat).toEqual([
			{
				id: "parent",
				name: "Parent",
				startOffset: 0,
				duration: 500,
				parentId: null,
			},
			{
				id: "child1",
				name: "Child 1",
				startOffset: 50,
				duration: 100,
				parentId: "parent",
			},
			{
				id: "child2",
				name: "Child 2",
				startOffset: 200,
				duration: 100,
				parentId: "parent",
			},
		]);
	});

	it("flattens deeply nested tree", () => {
		const tree = [
			{
				id: "root",
				name: "Root",
				startOffset: 0,
				duration: 500,
				children: [
					{
						id: "child",
						name: "Child",
						startOffset: 50,
						duration: 200,
						children: [
							{
								id: "grandchild",
								name: "Grandchild",
								startOffset: 100,
								duration: 50,
								children: [],
							},
						],
					},
				],
			},
		];
		const flat = flattenSpanTree(tree);
		expect(flat).toHaveLength(3);
		expect(flat[0].parentId).toBe(null);
		expect(flat[1].parentId).toBe("root");
		expect(flat[2].parentId).toBe("child");
	});
});
