import { describe, expect, it } from "vitest";
import { getSpanSelectionTimeMs } from "./spanSelection";

describe("getSpanSelectionTimeMs", () => {
	const span = { startOffsetMs: 1200, durationMs: 350 };

	it("returns the span start for start placement", () => {
		expect(getSpanSelectionTimeMs(span, "start")).toBe(1200);
	});

	it("returns the span end for end placement", () => {
		expect(getSpanSelectionTimeMs(span, "end")).toBe(1550);
	});
});
