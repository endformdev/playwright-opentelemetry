import { describe, expect, it } from "vitest";
import { parseComparisonLabel } from "./viewerComparison";

const label = (query: string) =>
	parseComparisonLabel(new URLSearchParams(query));

describe("parseComparisonLabel", () => {
	it("uses the given label", () => {
		expect(label("compareLabel=Last%20passing%20run%20on%20main")).toBe(
			"Last passing run on main",
		);
	});

	it("falls back to Baseline", () => {
		expect(label("")).toBe("Baseline");
		expect(label("compareLabel=%20%20")).toBe("Baseline");
	});

	it("trims and shortens a long label", () => {
		expect(label(`compareLabel=%20${"x".repeat(200)}`)).toBe("x".repeat(80));
	});
});
