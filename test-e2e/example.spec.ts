import { expect } from "@playwright/test";
import { test } from "../dist/fixture.mjs";

test("has title", async ({ page }) => {
	console.log(`test: ${Date.now()}`);
	await test.step("Step 1", async () => {
		console.log(`step 1: ${Date.now()}`);
		await page.goto("https://playwright.dev/");
	});
	console.log(`page.goto: ${Date.now()}`);

	// Expect a title "to contain" a substring.
	await test.step("Step 2", async () => {
		await expect(page).toHaveTitle(/Playwright/);
		console.log(`expect: ${Date.now()}`);
	});
});

// test.describe("described tests", () => {
// 	test("get started link", async ({ page }) => {
// 		await page.goto("https://playwright.dev/");

// 		await test.step("Check the get started page", async () => {
// 			await page.getByRole("link", { name: "Get started" }).click();

// 			await expect(
// 				page.getByRole("heading", { name: "Installation" }),
// 			).toBeVisible();
// 		});
// 	});
// });
