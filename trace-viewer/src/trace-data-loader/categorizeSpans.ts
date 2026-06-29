import type { Span } from "./exportToSpans";

const PLAYWRIGHT_TESTS_SERVICE_NAME = "playwright-tests";
const PLAYWRIGHT_BROWSER_SERVICE_NAME = "playwright-browser";

export function categorizeSpan(
	span: Span,
): "step" | "browserSpan" | "externalSpan" {
	if (span.serviceName === PLAYWRIGHT_TESTS_SERVICE_NAME) {
		return "step";
	}
	if (span.serviceName === PLAYWRIGHT_BROWSER_SERVICE_NAME) {
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
		if (span.serviceName === PLAYWRIGHT_TESTS_SERVICE_NAME) {
			steps.push(span);
		} else if (span.serviceName === PLAYWRIGHT_BROWSER_SERVICE_NAME) {
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
