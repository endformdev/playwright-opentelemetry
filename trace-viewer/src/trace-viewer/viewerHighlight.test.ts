import { describe, expect, it } from "vitest";
import { parseViewerHighlight } from "./viewerHighlight";

function highlight(query: string) {
	return parseViewerHighlight(new URLSearchParams(query));
}

describe("parseViewerHighlight", () => {
	it("highlights nothing without a span", () => {
		expect(highlight("")).toBeNull();
		expect(
			highlight("highlightSpanId=%20&highlightSpanLabel=Changed"),
		).toBeNull();
	});

	it("highlights the span with the given label", () => {
		expect(
			highlight(
				"highlightSpanId=abc123&highlightSpanLabel=Changed%20around%20here",
			),
		).toEqual({ spanId: "abc123", label: "Changed around here" });
	});

	it("falls back to a generic label", () => {
		expect(highlight("highlightSpanId=abc123")).toEqual({
			spanId: "abc123",
			label: "Highlighted step",
		});
	});

	it("shortens a long label", () => {
		const label = "x".repeat(200);
		expect(
			highlight(`highlightSpanId=abc123&highlightSpanLabel=${label}`)?.label,
		).toHaveLength(80);
	});
});
