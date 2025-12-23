import { expect } from "@playwright/test";
import { test } from "../dist/fixture.mjs";

test.describe("described tests", () => {
	test("get started link", async ({ page }) => {
		await page.goto("https://playwright.dev/");

		await test.step("Check the get started page", async () => {
			await page.getByRole("link", { name: "Get started" }).click();

			await expect(
				page.getByRole("heading", { name: "Installation" }),
			).toBeVisible();
		});
	});

	test("get started link 2", async ({ page }) => {
		await page.goto("https://playwright.dev/");

		await test.step("Check the get started page", async () => {
			await page.getByRole("link", { name: "Get started" }).click();

			await expect(
				page.getByRole("heading", { name: "Installation" }),
			).toBeVisible();
		});
	});
});
