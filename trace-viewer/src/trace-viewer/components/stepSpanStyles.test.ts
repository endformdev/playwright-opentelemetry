import { describe, expect, it } from "vitest";
import type { Span } from "../../trace-data-loader/exportToSpans";
import {
	getStepDepthColor,
	getStepTimelineColor,
	isPlaywrightStepSpan,
	NON_PLAYWRIGHT_STEP_COLOR,
} from "./stepSpanStyles";

describe("step timeline span styles", () => {
	it("keeps Playwright step spans on depth-based colours", () => {
		const span = createSpan({
			name: "playwright.test.step",
			attributes: { "http.resource.type": "fetch" },
		});

		expect(isPlaywrightStepSpan(span)).toBe(true);
		expect(getStepTimelineColor(span, 2)).toBe(getStepDepthColor(2));
	});

	it("uses browser fetch colour for worker fetch spans regardless of depth", () => {
		const span = createSpan({
			name: "HTTP GET",
			attributes: { "http.resource.type": "fetch" },
		});

		expect(getStepTimelineColor(span, 0)).toBe("#eb7820");
		expect(getStepTimelineColor(span, 4)).toBe("#eb7820");
	});

	it("uses grey for future non-step non-fetch spans regardless of depth", () => {
		const span = createSpan({
			name: "custom.worker.span",
			attributes: {},
		});

		expect(getStepTimelineColor(span, 0)).toBe(NON_PLAYWRIGHT_STEP_COLOR);
		expect(getStepTimelineColor(span, 4)).toBe(NON_PLAYWRIGHT_STEP_COLOR);
	});
});

function createSpan(overrides: Partial<Span> = {}): Span {
	return {
		id: "span1",
		parentId: null,
		traceId: "trace1",
		name: "test.span",
		title: "Test Span",
		startOffsetMs: 0,
		durationMs: 100,
		kind: "internal",
		attributes: {},
		serviceName: "playwright-tests",
		...overrides,
	};
}
