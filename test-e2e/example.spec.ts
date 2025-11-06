import { expect, test } from "@playwright/test";

test("has title", async ({ page }) => {
	await page.goto("https://playwright.dev/");

	// Expect a title "to contain" a substring.
	await expect(page).toHaveTitle(/Playwright/);
});

test("get started link", async ({ page }) => {
	await page.goto("https://playwright.dev/");

	await test.step("Check the get started page", async () => {
		await page.getByRole("link", { name: "Get started" }).click();

		await expect(
			page.getByRole("heading", { name: "Installation" }),
		).toBeVisible();
	});
});
