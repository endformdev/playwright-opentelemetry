import type { Span } from "../../trace-data-loader/exportToSpans";
import { getResourceColor, getResourceType } from "./browserResourceStyles";

export const NON_PLAYWRIGHT_STEP_COLOR = getResourceColor("other");

/**
 * A clearly different hue for each depth, so nesting reads at a glance: blue
 * at the test, ending on Endform's aubergine before starting over.
 */
const STEP_DEPTH_COLORS = [
	"#2f7bc8",
	"#4a4fc4",
	"#8b45bd",
	"#bf4fa6",
	"#5a2a66",
];

export function getStepDepthColor(depth: number): string {
	return STEP_DEPTH_COLORS[depth % STEP_DEPTH_COLORS.length];
}

export function isPlaywrightStepSpan(span: Pick<Span, "name">): boolean {
	return (
		span.name === "playwright.test" || span.name === "playwright.test.step"
	);
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
