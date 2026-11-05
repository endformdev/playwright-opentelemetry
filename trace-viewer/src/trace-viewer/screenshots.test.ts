import { describe, expect, it } from "vitest";
import type { ScreenshotInfo } from "../trace-info-loader";
import {
	findFirstContentfulScreenshot,
	isBlankPixels,
	MAX_BLANK_CHECKS,
} from "./screenshots";

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

	describe("with a long run of blank frames", () => {
		const frames = Array.from({ length: MAX_BLANK_CHECKS + 10 }, (_, index) =>
			screenshot(index),
		);

		it("finds content on the last frame it checks", async () => {
			const last = MAX_BLANK_CHECKS - 1;
			expect(
				await findFirstContentfulScreenshot(frames, blankUntil(last)),
			).toBe(frames[last]);
		});

		it("gives up on the first frame beyond the limit", async () => {
			expect(
				await findFirstContentfulScreenshot(
					frames,
					blankUntil(MAX_BLANK_CHECKS),
				),
			).toBe(frames[0]);
		});

		it("checks no more frames than the limit", async () => {
			let checks = 0;
			await findFirstContentfulScreenshot(frames, async () => {
				checks++;
				return true;
			});
			expect(checks).toBe(MAX_BLANK_CHECKS);
		});
	});

	it("finds nothing without screenshots", async () => {
		expect(await findFirstContentfulScreenshot([])).toBeNull();
	});
});
