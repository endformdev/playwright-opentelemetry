import { describe, expect, it } from "vitest";
import {
	calculateInitialPanelSizes,
	getPlayerFilmstripSizePercent,
	MIN_PLAYER_SIZE_PERCENT,
	PLAYER_BIG_SCREEN_SIZE_PERCENT,
} from "./panelSizing";

describe("calculateInitialPanelSizes", () => {
	it("returns empty object when no panels are active", () => {
		const result = calculateInitialPanelSizes({
			steps: false,
			browser: false,
			external: false,
		});

		expect(result).toEqual({});
	});

	it("returns 100% for a single active panel", () => {
		const result = calculateInitialPanelSizes({
			steps: true,
			browser: false,
			external: false,
		});

		expect(result).toEqual({ steps: 100 });
	});

	it("uses a 40/60 split for steps and browser panels", () => {
		const result = calculateInitialPanelSizes({
			steps: true,
			browser: true,
			external: false,
		});

		expect(result).toEqual({ steps: 40, browser: 60 });
	});

	it("uses a 50/50 split for steps and external panels", () => {
		const result = calculateInitialPanelSizes({
			steps: true,
			browser: false,
			external: true,
		});

		expect(result).toEqual({ steps: 50, external: 50 });
	});

	it("uses a 50/50 split for browser and external panels", () => {
		const result = calculateInitialPanelSizes({
			steps: false,
			browser: true,
			external: true,
		});

		expect(result).toEqual({ browser: 50, external: 50 });
	});

	it("gives three active panels a third each", () => {
		const result = calculateInitialPanelSizes({
			steps: true,
			browser: true,
			external: true,
		});

		expect(result.steps).toBeCloseTo(33.33, 1);
		expect(result.browser).toBeCloseTo(33.33, 1);
		expect(result.external).toBeCloseTo(33.33, 1);
	});
});

describe("getPlayerFilmstripSizePercent", () => {
	it("is smaller than the big screen, leaving room for the spans", () => {
		expect(getPlayerFilmstripSizePercent(1, 800)).toBeCloseTo(33);
		expect(getPlayerFilmstripSizePercent(2, 800)).toBeCloseTo(41.5);
	});

	it("never takes more than the big screen", () => {
		expect(getPlayerFilmstripSizePercent(8, 800)).toBe(
			PLAYER_BIG_SCREEN_SIZE_PERCENT,
		);
	});

	it("stays above the player's minimum in a tall column", () => {
		expect(getPlayerFilmstripSizePercent(1, 2000)).toBe(
			MIN_PLAYER_SIZE_PERCENT,
		);
	});

	it("uses the big screen's size until the column is measured", () => {
		expect(getPlayerFilmstripSizePercent(1, 0)).toBe(
			PLAYER_BIG_SCREEN_SIZE_PERCENT,
		);
	});
});
