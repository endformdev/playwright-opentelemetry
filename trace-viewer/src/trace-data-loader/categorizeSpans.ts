import type { Span } from "./exportToSpans";

const STEP_SPAN_NAMES = new Set(["playwright.test", "playwright.test.step"]);

export function categorizeSpan(
	span: Span,
): "step" | "browserSpan" | "externalSpan" {
	if (STEP_SPAN_NAMES.has(span.name)) {
		return "step";
	}
	if (span.serviceName === "playwright-browser") {
		return "browserSpan";
	}
	return "externalSpan";
}

export interface CategorizedSpans {
	steps: Span[];
	browserSpans: Span[];
	externalSpans: Span[];
}

export function categorizeSpans(allSpans: Span[]): CategorizedSpans {
	const steps: Span[] = [];
	const browserSpans: Span[] = [];
	const externalSpans: Span[] = [];

	for (const span of allSpans) {
		if (STEP_SPAN_NAMES.has(span.name)) {
			steps.push(span);
		} else if (span.serviceName === "playwright-browser") {
			browserSpans.push(span);
		} else {
			externalSpans.push(span);
		}
	}

	return { steps, browserSpans, externalSpans };
}

export function mergeSpans(
	existing: CategorizedSpans,
	incoming: CategorizedSpans,
): CategorizedSpans {
	const steps = [...existing.steps, ...incoming.steps].sort(
		(a, b) => a.startOffsetMs - b.startOffsetMs,
	);
	const browserSpans = [
		...existing.browserSpans,
		...incoming.browserSpans,
	].sort((a, b) => a.startOffsetMs - b.startOffsetMs);
	const externalSpans = [
		...existing.externalSpans,
		...incoming.externalSpans,
	].sort((a, b) => a.startOffsetMs - b.startOffsetMs);

	return { steps, browserSpans, externalSpans };
}
