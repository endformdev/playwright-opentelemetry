import type { Span } from "../trace-data-loader/exportToSpans";

/**
 * Lets the page linking to the viewer highlight moments of the trace, e.g.
 * every step that changed or failed. Each highlight is drawn on the step
 * ruler with its label, and the viewer opens on the first one the trace
 * contains. Highlights only ever name spans of this trace, never the
 * comparison's.
 *
 * ## Query parameter
 *
 * One repeated `highlight` parameter per highlight; the viewer opens on the
 * first:
 *
 *     highlight=<field>~<field>~...
 *
 * Each field is `key:value`, and fields are separated by `~`:
 *
 * | Field                       | Meaning                                                                                |
 * | --------------------------- | -------------------------------------------------------------------------------------- |
 * | `span:<spanId>`             | The span's ID, 16 hex characters                                                       |
 * | `time:<ms>`                 | When the step started, in whole Unix epoch milliseconds                                |
 * | `loc:<file>:<line>[:<col>]` | The step's source: `code.file.path`, `code.line.number` and `code.column.number`       |
 * | `at:start` or `at:end`      | Open on the span's start, or by default on its result (after the last step inside it) |
 * | `label:<text>`              | Caption, at most 120 characters. Must come last: it runs to the end, `~` and all       |
 *
 * A highlight needs at least one of `span`, `time` and `loc`. Unknown keys are
 * ignored, as are highlights with no target, and the first 20 are kept. The
 * values are URL-encoded like any query parameter, e.g. with
 * `URLSearchParams.append("highlight", "time:1731234567890~loc:tests/login.spec.ts:12:5~label:Fills the form")`:
 *
 *     ?traceSource=...&highlight=time%3A1731234567890%7Eloc%3Atests%2Flogin.spec.ts%3A12%3A5%7Elabel%3AFills+the+form
 *
 * ## Finding the span
 *
 * See resolveViewerHighlight. In short: `span` names the span exactly; `time`
 * and `loc` find a test step, `time` first; `loc` alone picks the failed or
 * else the last step at that line, as in a loop. A highlight the trace has no
 * span for is left out.
 */

export const VIEWER_HIGHLIGHT_QUERY_PARAM_NAME = "highlight";

const FIELD_SEPARATOR = "~";
const MAX_HIGHLIGHTS = 20;
const MAX_HIGHLIGHT_LABEL_LENGTH = 120;

export interface ViewerHighlightLocation {
	/** `code.file.path`, relative to the project root as the reporter writes it */
	file: string;
	/** `code.line.number`, 1-based */
	line: number;
	/** `code.column.number`, 1-based; older traces don't record it */
	column?: number;
}

export interface ViewerHighlight {
	/** The span's ID, 16 hex characters */
	spanId?: string;
	/** When the step started, in Unix epoch milliseconds */
	startTimeMs?: number;
	/** Where the step is in the test's source */
	location?: ViewerHighlightLocation;
	/** A short caption */
	label?: string;
	/** Where the viewer opens: the span's start, or its result (the default) */
	at?: "start" | "end";
}

/** A highlight with the span of the trace it names */
export interface ResolvedViewerHighlight {
	span: Span;
	label: string | null;
	at: "start" | "end";
}

/** `<file>:<line>[:<column>]`; a column, when it could be one, is taken as one */
function parseLocation(value: string): ViewerHighlightLocation | undefined {
	const withColumn = /^(.+):(\d+):(\d+)$/.exec(value);
	if (withColumn) {
		return {
			file: withColumn[1],
			line: Number(withColumn[2]),
			column: Number(withColumn[3]),
		};
	}
	const lineOnly = /^(.+):(\d+)$/.exec(value);
	if (lineOnly) return { file: lineOnly[1], line: Number(lineOnly[2]) };
	return undefined;
}

/** One `highlight` parameter's value, or null when it names no target. */
export function parseViewerHighlight(value: string): ViewerHighlight | null {
	const highlight: ViewerHighlight = {};
	let rest = value;
	while (rest) {
		// The label runs to the end, so it may hold the separator.
		if (rest.startsWith("label:")) {
			const label = rest.slice("label:".length).trim();
			if (label) highlight.label = label.slice(0, MAX_HIGHLIGHT_LABEL_LENGTH);
			break;
		}
		const end = rest.indexOf(FIELD_SEPARATOR);
		const field = end === -1 ? rest : rest.slice(0, end);
		rest = end === -1 ? "" : rest.slice(end + 1);

		const colon = field.indexOf(":");
		if (colon === -1) continue;
		const key = field.slice(0, colon).trim();
		const fieldValue = field.slice(colon + 1).trim();
		switch (key) {
			case "span":
				if (fieldValue) highlight.spanId = fieldValue;
				break;
			case "time":
				if (/^\d+$/.test(fieldValue)) {
					highlight.startTimeMs = Number(fieldValue);
				}
				break;
			case "loc": {
				const location = parseLocation(fieldValue);
				if (location) highlight.location = location;
				break;
			}
			case "at":
				if (fieldValue === "start" || fieldValue === "end") {
					highlight.at = fieldValue;
				}
				break;
		}
	}

	const hasTarget =
		highlight.spanId !== undefined ||
		highlight.startTimeMs !== undefined ||
		highlight.location !== undefined;
	return hasTarget ? highlight : null;
}

/** The highlights named by the query parameters, in their order. */
export function parseViewerHighlights(
	params: URLSearchParams,
): ViewerHighlight[] {
	return params
		.getAll(VIEWER_HIGHLIGHT_QUERY_PARAM_NAME)
		.map(parseViewerHighlight)
		.filter((highlight): highlight is ViewerHighlight => highlight !== null)
		.slice(0, MAX_HIGHLIGHTS);
}

export function readViewerHighlightsFromQueryParams(): ViewerHighlight[] {
	if (typeof window === "undefined") return [];
	return parseViewerHighlights(new URLSearchParams(window.location.search));
}

export interface ViewerHighlightSpans {
	/** Every span of the trace, by ID */
	spanById: ReadonlyMap<string, Span>;
	/** The test and its steps, which `time` and `loc` look among */
	steps: readonly Span[];
	/** When the test started, in whole Unix epoch milliseconds */
	testStartTimeMs: number;
}

function normalizePath(path: string): string {
	return path.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
}

/**
 * The same file, allowing for a different root: one path may be the other
 * with more directories in front, as when the reporter ran from elsewhere.
 */
function isSameFile(a: string, b: string): boolean {
	const pathA = normalizePath(a);
	const pathB = normalizePath(b);
	return (
		pathA === pathB ||
		pathA.endsWith(`/${pathB}`) ||
		pathB.endsWith(`/${pathA}`)
	);
}

function numberAttribute(span: Span, key: string): number | undefined {
	const value = span.attributes[key];
	if (typeof value === "number") return value;
	if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
	return undefined;
}

/** The column counts only when both the highlight and the span have one. */
function isAtLocation(span: Span, location: ViewerHighlightLocation): boolean {
	const file = span.attributes["code.file.path"];
	if (typeof file !== "string" || !isSameFile(file, location.file)) {
		return false;
	}
	if (numberAttribute(span, "code.line.number") !== location.line) {
		return false;
	}
	const column = numberAttribute(span, "code.column.number");
	return (
		location.column === undefined ||
		column === undefined ||
		column === location.column
	);
}

/**
 * Of steps starting in the same millisecond, the outermost: a step and the
 * first one inside it start together, and the outer one's highlight covers
 * both.
 */
function outermost(steps: Span[]): Span | null {
	let found: Span | null = null;
	for (const step of steps) {
		if (!found || step.durationMs > found.durationMs) found = step;
	}
	return found;
}

/**
 * Of steps at one source location, as in a loop: the first that failed, or
 * else the last to run.
 */
function failedOrLast(steps: Span[]): Span | null {
	const failed = steps.find((step) => step.status?.code === 2);
	if (failed) return failed;
	return steps.reduce<Span | null>(
		(last, step) =>
			!last || step.startOffsetMs >= last.startOffsetMs ? step : last,
		null,
	);
}

/**
 * The span of the trace a highlight names, or null when there is none:
 *
 * 1. `spanId`: that exact span.
 * 2. `startTimeMs` and `location`: the step starting in that millisecond at
 *    that location (file, line, and column when both have one). When none is
 *    at that location, as when an older trace's path differs, the step
 *    starting in that millisecond. When no step starts then, as (4).
 * 3. `startTimeMs`: the step starting in that millisecond.
 * 4. `location`: the step at that location; of several, as in a loop, the
 *    first that failed, else the last.
 *
 * Several steps starting in the same millisecond are nested, and the
 * outermost one is taken. A `spanId` the trace doesn't contain falls through
 * to the highlight's other targets.
 */
export function resolveViewerHighlight(
	highlight: ViewerHighlight,
	spans: ViewerHighlightSpans,
): Span | null {
	if (highlight.spanId) {
		const span = spans.spanById.get(highlight.spanId);
		if (span) return span;
	}

	const { startTimeMs, location } = highlight;
	if (startTimeMs !== undefined) {
		const startingThen = spans.steps.filter(
			(step) => spans.testStartTimeMs + step.startOffsetMs === startTimeMs,
		);
		if (location) {
			const atLocation = startingThen.filter((step) =>
				isAtLocation(step, location),
			);
			if (atLocation.length > 0) return outermost(atLocation);
		}
		const step = outermost(startingThen);
		if (step || !location) return step;
	}

	if (location) {
		return failedOrLast(
			spans.steps.filter((step) => isAtLocation(step, location)),
		);
	}
	return null;
}

/**
 * The highlights the trace has spans for, in their order. A span highlighted
 * twice to open at the same place is kept once, with its first label.
 */
export function resolveViewerHighlights(
	highlights: readonly ViewerHighlight[],
	spans: ViewerHighlightSpans,
): ResolvedViewerHighlight[] {
	const resolved: ResolvedViewerHighlight[] = [];
	const seen = new Set<string>();
	for (const highlight of highlights) {
		const span = resolveViewerHighlight(highlight, spans);
		if (!span) continue;
		const at = highlight.at ?? "end";
		const key = `${span.id}:${at}`;
		if (seen.has(key)) continue;
		seen.add(key);
		resolved.push({ span, label: highlight.label ?? null, at });
	}
	return resolved;
}
