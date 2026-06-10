import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { test } from "../dist/fixture.mjs";

test("browser console and page error span events", async ({
	page,
}: {
	page: Page;
}) => {
	await page.goto("https://example.com/");
	const pageErrorPromise = page.waitForEvent("pageerror");
	await page.evaluate(async () => {
		const delay = (ms: number) =>
			new Promise((resolve) => setTimeout(resolve, ms));

		console.info("Browser span info event");
		await delay(100);
		console.warn("Browser span warning event");
		await delay(100);
		console.error("Browser span error event");
		await delay(100);
		setTimeout(() => {
			throw new Error("Browser span thrown error");
		}, 0);
	});
	await pageErrorPromise;

	await expect(page.locator("body")).toContainText("Example Domain");
});
