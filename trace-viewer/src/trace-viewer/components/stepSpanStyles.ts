import type { Span } from "../../trace-data-loader/exportToSpans";
import { getResourceColor, getResourceType } from "./browserResourceStyles";

export const NON_PLAYWRIGHT_STEP_COLOR = getResourceColor("other");

export function getStepDepthColor(depth: number): string {
	return `hsl(${210 + depth * 30}, 70%, ${55 + depth * 5}%)`;
}

export function isPlaywrightStepSpan(span: Pick<Span, "name">): boolean {
	return span.name === "playwright.test" || span.name === "playwright.test.step";
}

export function getStepTimelineColor(span: Span, depth: number): string {
	if (isPlaywrightStepSpan(span)) {
		return getStepDepthColor(depth);
	}

	const resourceType = getResourceType(span);
	return resourceType === "fetch"
		? getResourceColor("fetch")
		: NON_PLAYWRIGHT_STEP_COLOR;
}
