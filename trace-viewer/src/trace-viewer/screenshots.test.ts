import { describe, expect, it } from "vitest";
import type { ScreenshotInfo } from "../trace-info-loader";
import { findFirstContentfulScreenshot, isBlankPixels } from "./screenshots";

function pixels(...colors: [number, number, number][]): Uint8ClampedArray {
	return Uint8ClampedArray.from(colors.flatMap((color) => [...color, 255]));
}

function screenshot(timestamp: number): ScreenshotInfo {
	return { timestamp, url: `/screenshots/${timestamp}`, pageId: "page" };
}

describe("isBlankPixels", () => {
	it("counts a single colour of any kind as blank", () => {
		expect(isBlankPixels(pixels([255, 255, 255], [255, 255, 255]))).toBe(true);
		expect(isBlankPixels(pixels([18, 18, 18], [18, 18, 18]))).toBe(true);
	});

	it("ignores compression noise", () => {
		expect(isBlankPixels(pixels([255, 255, 255], [250, 252, 254]))).toBe(true);
	});

	it("counts one pixel of content as not blank", () => {
		const page = Array.from({ length: 99 }, (): [number, number, number] => [
			255, 255, 255,
		]);
		expect(isBlankPixels(pixels(...page, [200, 200, 200]))).toBe(false);
	});

	it("compares each channel with the same channel", () => {
		expect(isBlankPixels(pixels([255, 0, 0], [255, 0, 0]))).toBe(true);
		expect(isBlankPixels(pixels([255, 0, 0], [255, 40, 0]))).toBe(false);
	});
});

describe("findFirstContentfulScreenshot", () => {
	const blankUntil = (timestamp: number) => async (url: string) =>
		Number(url.split("/").pop()) < timestamp;

	it("skips the blank frames at the start", async () => {
		const screenshots = [screenshot(100), screenshot(200), screenshot(300)];
		expect(
			await findFirstContentfulScreenshot(screenshots, blankUntil(200)),
		).toBe(screenshots[1]);
	});

	it("goes through the frames in time order", async () => {
		const screenshots = [screenshot(300), screenshot(100), screenshot(200)];
		expect(
			await findFirstContentfulScreenshot(screenshots, blankUntil(200)),
		).toBe(screenshots[2]);
	});

	it("stops at the first frame with content", async () => {
		const checked: string[] = [];
		await findFirstContentfulScreenshot(
			[screenshot(100), screenshot(200), screenshot(300)],
			async (url) => {
				checked.push(url);
				return url.endsWith("/100");
			},
		);
		expect(checked).toEqual(["/screenshots/100", "/screenshots/200"]);
	});

	it("falls back to the first frame when all are blank", async () => {
		const screenshots = [screenshot(200), screenshot(100)];
		expect(
			await findFirstContentfulScreenshot(screenshots, async () => true),
		).toBe(screenshots[1]);
	});

	it("finds nothing without screenshots", async () => {
		expect(await findFirstContentfulScreenshot([])).toBeNull();
	});
});
