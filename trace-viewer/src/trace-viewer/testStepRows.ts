import type { Span } from "../trace-data-loader/exportToSpans";

/**
 * For tests: step spans written as rows, one line each, so cases about how
 * two runs differ stay readable.
 */

/** `[category, title, subtitle, line, startMs, endMs, children?]` */
export type StepRow = [
	category: "test.step" | "pw:api" | "expect",
	title: string,
	subtitle: string | null,
	line: number | null,
	startMs: number,
	endMs: number,
	children?: StepRow[],
];

/**
 * Turns rows into `playwright.test.step` spans. Ids are the side's prefix and
 * the row's path, `a:1` or `a:1.0`, so assertions can name steps.
 */
export function stepsFromRows(
	prefix: string,
	rows: StepRow[],
	parentId: string | null = null,
	path = "",
): Span[] {
	return rows.flatMap((row, index) => {
		const [category, title, subtitle, line, startMs, endMs, children] = row;
		const id = `${prefix}:${path}${index}`;
		const span: Span = {
			id,
			parentId,
			traceId: `trace-${prefix}`,
			name: "playwright.test.step",
			title,
			...(subtitle !== null && { subtitle }),
			startOffsetMs: startMs,
			durationMs: endMs - startMs,
			kind: "internal",
			attributes: {
				"test.step.category": category,
				...(line !== null && {
					"code.file.path": "tests/example.spec.ts",
					"code.line.number": line,
				}),
			},
			serviceName: "playwright",
		};
		return [
			span,
			...stepsFromRows(prefix, children ?? [], id, `${path}${index}.`),
		];
	});
}
