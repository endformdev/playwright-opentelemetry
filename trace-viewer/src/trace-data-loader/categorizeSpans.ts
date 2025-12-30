import type { Span } from "./exportToSpans";

const STEP_SPAN_NAMES = new Set(["playwright.test", "playwright.test.step"]);

export function categorizeSpan(span: Span): "step" | "span" {
	return STEP_SPAN_NAMES.has(span.name) ? "step" : "span";
}

export interface CategorizedSpans {
	steps: Span[];
	spans: Span[];
}

export function categorizeSpans(allSpans: Span[]): CategorizedSpans {
	const steps: Span[] = [];
	const spans: Span[] = [];

	for (const span of allSpans) {
		if (categorizeSpan(span) === "step") {
			steps.push(span);
		} else {
			spans.push(span);
		}
	}

	return { steps, spans };
}

export function mergeSpans(
	existing: CategorizedSpans,
	incoming: CategorizedSpans,
): CategorizedSpans {
	const steps = [...existing.steps, ...incoming.steps].sort(
		(a, b) => a.startOffsetMs - b.startOffsetMs,
	);
	const spans = [...existing.spans, ...incoming.spans].sort(
		(a, b) => a.startOffsetMs - b.startOffsetMs,
	);

	return { steps, spans };
}
