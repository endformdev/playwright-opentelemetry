/**
 * Span packing utilities for timeline visualization.
 * Assigns rows to spans to minimize vertical space while respecting:
 * 1. Parent-child relationships (children below parents)
 * 2. Non-overlapping constraint (no two spans on same row overlap in time)
 * 3. Relative ordering (prefer keeping spans in their original order when possible)
 */

/**
 * Input span with timing and hierarchy information
 */
export interface SpanInput {
	id: string;
	name: string;
	startOffset: number; // ms from timeline start
	duration: number; // ms
	parentId: string | null; // null for root spans
}

/**
 * Output span with assigned row for rendering
 */
export interface PackedSpan extends SpanInput {
	row: number; // 0-based row index for rendering
}

/**
 * Result of packing spans into rows
 */
export interface PackedSpansResult {
	spans: PackedSpan[];
	totalRows: number;
}

/**
 * Checks if two spans overlap in time.
 * Spans are considered overlapping if they share any time range.
 *
 * @param a - First span
 * @param b - Second span
 * @returns true if spans overlap in time
 */
export function spansOverlap(
	a: { startOffset: number; duration: number },
	b: { startOffset: number; duration: number },
): boolean {
	const aEnd = a.startOffset + a.duration;
	const bEnd = b.startOffset + b.duration;

	// No overlap if one ends before the other starts
	return !(aEnd <= b.startOffset || bEnd <= a.startOffset);
}

/**
 * Finds the minimum row where a span can be placed without overlapping
 * any existing spans on that row.
 *
 * @param span - The span to place
 * @param rows - Array of arrays, where each inner array contains spans on that row
 * @param minRow - Minimum row to consider (e.g., parent's row + 1)
 * @returns The row index where the span can be placed
 */
export function findAvailableRow(
	span: { startOffset: number; duration: number },
	rows: Array<Array<{ startOffset: number; duration: number }>>,
	minRow: number,
): number {
	for (let row = minRow; row < rows.length; row++) {
		const rowSpans = rows[row];
		const hasOverlap = rowSpans.some((existing) =>
			spansOverlap(span, existing),
		);
		if (!hasOverlap) {
			return row;
		}
	}
	// No existing row works, need a new row
	return rows.length;
}

/**
 * Packs spans into rows for compact timeline visualization.
 *
 * Algorithm:
 * 1. Build a parent-child lookup map
 * 2. Process spans in their original order (respecting relative ordering)
 * 3. For each span:
 *    - Determine minimum row (parent's row + 1, or 0 for root spans)
 *    - Find the first available row >= minRow where span doesn't overlap
 *    - Assign the span to that row
 *
 * This ensures:
 * - Children are always below their parents
 * - No horizontal overlap within a row
 * - Relative ordering is preserved (earlier spans in input get priority for rows)
 *
 * @param spans - Array of spans with timing and parent information
 * @returns PackedSpansResult with row assignments and total row count
 *
 * @example
 * // Two non-overlapping root spans can share row 0
 * packSpans([
 *   { id: 'a', startOffset: 0, duration: 100, parentId: null },
 *   { id: 'b', startOffset: 200, duration: 100, parentId: null },
 * ])
 * // Both get row: 0
 *
 * @example
 * // Overlapping spans get different rows
 * packSpans([
 *   { id: 'a', startOffset: 0, duration: 200, parentId: null },
 *   { id: 'b', startOffset: 100, duration: 200, parentId: null },
 * ])
 * // 'a' gets row: 0, 'b' gets row: 1
 *
 * @example
 * // Children are placed below parents
 * packSpans([
 *   { id: 'parent', startOffset: 0, duration: 500, parentId: null },
 *   { id: 'child', startOffset: 100, duration: 100, parentId: 'parent' },
 * ])
 * // 'parent' gets row: 0, 'child' gets row: 1
 */
export function packSpans(spans: SpanInput[]): PackedSpansResult {
	if (spans.length === 0) {
		return { spans: [], totalRows: 0 };
	}

	// Map from span ID to assigned row
	const spanRowMap = new Map<string, number>();

	// Rows array: each element is an array of spans on that row (for overlap checking)
	const rows: Array<Array<{ startOffset: number; duration: number }>> = [];

	// Process spans in order
	const packedSpans: PackedSpan[] = [];

	for (const span of spans) {
		// Determine minimum row based on parent
		let minRow = 0;
		if (span.parentId !== null) {
			const parentRow = spanRowMap.get(span.parentId);
			if (parentRow !== undefined) {
				minRow = parentRow + 1;
			}
		}

		// Find available row
		const row = findAvailableRow(span, rows, minRow);

		// Ensure row exists in our tracking array
		while (rows.length <= row) {
			rows.push([]);
		}

		// Add span to the row
		rows[row].push({ startOffset: span.startOffset, duration: span.duration });
		spanRowMap.set(span.id, row);

		// Create packed span
		packedSpans.push({
			...span,
			row,
		});
	}

	return {
		spans: packedSpans,
		totalRows: rows.length,
	};
}

/**
 * Converts a hierarchical span tree to a flat array suitable for packSpans.
 * Preserves the tree traversal order (pre-order: parent before children).
 *
 * @param spans - Hierarchical spans with children arrays
 * @param parentId - Parent ID for recursion (null for root)
 * @returns Flat array of SpanInput
 */
export function flattenSpanTree<
	T extends {
		id: string;
		name: string;
		startOffset: number;
		duration: number;
		children: T[];
	},
>(spans: T[], parentId: string | null = null): SpanInput[] {
	const result: SpanInput[] = [];

	for (const span of spans) {
		result.push({
			id: span.id,
			name: span.name,
			startOffset: span.startOffset,
			duration: span.duration,
			parentId,
		});

		// Recursively add children
		if (span.children.length > 0) {
			result.push(...flattenSpanTree(span.children, span.id));
		}
	}

	return result;
}
