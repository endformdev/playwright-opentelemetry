import { describe, expect, it } from "vitest";
import {
	calculateDepthBasedSizes,
	getSizesForActivePanels,
	isPanelActive,
} from "./panelSizing";

describe("calculateDepthBasedSizes", () => {
	it("returns empty object when no panels are active", () => {
		const result = calculateDepthBasedSizes({
			stepsDepth: 0,
			browserDepth: 0,
			externalDepth: 0,
		});
		expect(result).toEqual({});
	});

	it("returns 100% for single active panel", () => {
		const result = calculateDepthBasedSizes({
			stepsDepth: 5,
			browserDepth: 0,
			externalDepth: 0,
		});
		expect(result).toEqual({ steps: 100 });
	});

	it("distributes equally when depths are equal", () => {
		const result = calculateDepthBasedSizes({
			stepsDepth: 4,
			browserDepth: 4,
			externalDepth: 4,
		});
		// All panels have same effective depth (4), so equal distribution
		expect(result.steps).toBeCloseTo(33.33, 1);
		expect(result.browser).toBeCloseTo(33.33, 1);
		expect(result.external).toBeCloseTo(33.33, 1);
	});

	it("distributes proportionally based on depth", () => {
		const result = calculateDepthBasedSizes({
			stepsDepth: 8, // MIN_ROWS = 8
			browserDepth: 16, // 2x minimum
			externalDepth: 24, // 3x minimum
		});
		// Total effective depth: 8 + 16 + 24 = 48
		// steps: 8/48 = 16.67%
		// browser: 16/48 = 33.33%
		// external: 24/48 = 50%
		expect(result.steps).toBeCloseTo(16.67, 1);
		expect(result.browser).toBeCloseTo(33.33, 1);
		expect(result.external).toBeCloseTo(50, 1);
	});

	it("uses minimum of 4 rows for panels with less depth", () => {
		const result = calculateDepthBasedSizes({
			stepsDepth: 2, // Below minimum, will use 8
			browserDepth: 16,
			externalDepth: 0, // Inactive
		});
		// Total effective depth: 8 + 16 = 24
		// steps: 8/24 = 33.33%
		// browser: 16/24 = 66.67%
		expect(result.steps).toBeCloseTo(33.33, 1);
		expect(result.browser).toBeCloseTo(66.67, 1);
		expect(result.external).toBeUndefined();
	});

	it("handles two active panels correctly", () => {
		const result = calculateDepthBasedSizes({
			stepsDepth: 6,
			browserDepth: 0,
			externalDepth: 6,
		});
		// Both have same depth, equal split
		expect(result.steps).toBeCloseTo(50, 1);
		expect(result.browser).toBeUndefined();
		expect(result.external).toBeCloseTo(50, 1);
	});

	it("gives more space to panel with deeper nesting", () => {
		const result = calculateDepthBasedSizes({
			stepsDepth: 8,
			browserDepth: 40,
			externalDepth: 8,
		});
		// steps and external each get minimum (8)
		// browser gets the bulk (40)
		// Total: 8 + 40 + 8 = 56
		expect(result.steps).toBeCloseTo((8 / 56) * 100, 1);
		expect(result.browser).toBeCloseTo((40 / 56) * 100, 1);
		expect(result.external).toBeCloseTo((8 / 56) * 100, 1);
	});
});

describe("getSizesForActivePanels", () => {
	it("returns empty array when no panels active", () => {
		const result = getSizesForActivePanels({
			stepsDepth: 0,
			browserDepth: 0,
			externalDepth: 0,
		});
		expect(result).toEqual([]);
	});

	it("returns panels in correct order: steps, browser, external", () => {
		const result = getSizesForActivePanels({
			stepsDepth: 4,
			browserDepth: 4,
			externalDepth: 4,
		});
		expect(result).toHaveLength(3);
		expect(result[0].id).toBe("steps");
		expect(result[1].id).toBe("browser");
		expect(result[2].id).toBe("external");
	});

	it("only includes active panels", () => {
		const result = getSizesForActivePanels({
			stepsDepth: 4,
			browserDepth: 0,
			externalDepth: 4,
		});
		expect(result).toHaveLength(2);
		expect(result[0].id).toBe("steps");
		expect(result[1].id).toBe("external");
	});

	it("includes minSize for each panel", () => {
		const result = getSizesForActivePanels({
			stepsDepth: 4,
			browserDepth: 4,
			externalDepth: 0,
		});
		expect(result).toHaveLength(2);
		expect(result[0].minSize).toBeGreaterThan(0);
		expect(result[1].minSize).toBeGreaterThan(0);
	});
});

describe("isPanelActive", () => {
	it("returns false for depth of 0", () => {
		expect(isPanelActive(0)).toBe(false);
	});

	it("returns true for depth greater than 0", () => {
		expect(isPanelActive(1)).toBe(true);
		expect(isPanelActive(4)).toBe(true);
		expect(isPanelActive(100)).toBe(true);
	});
});
