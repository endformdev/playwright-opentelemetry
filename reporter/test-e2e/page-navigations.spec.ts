import { expect } from "@playwright/test";
import { test } from "../dist/fixture.mjs";

const TRACE_MARKER = "browser-page-span-e2e";

async function makeMarkedRequest(page: import("@playwright/test").Page, label: string) {
	await page.evaluate(
		`(async () => {
			const url = new URL(location.href);
			url.hash = "";
			url.search = "${TRACE_MARKER}=${label}-" + Date.now();

			const response = await fetch(url.href, {
				cache: "no-store",
			});
			if (!response.ok) {
				throw new Error("Marked request failed: " + response.status);
			}
		})()`,
	);
}

test("playwright.dev browser page navigation trace", async ({ page }) => {
	await page.goto("https://playwright.dev/");
	await expect(page).toHaveURL("https://playwright.dev/");
	await makeMarkedRequest(page, "home");

	await page.getByRole("link", { name: "Docs" }).first().click();
	await expect(page).toHaveURL(/\/docs\/intro/);
	await makeMarkedRequest(page, "docs-node");

	await page.goto("https://playwright.dev/python/docs/intro");
	await expect(page).toHaveURL(/\/python\/docs\/intro/);
	await makeMarkedRequest(page, "docs-python");

	await page.evaluate("location.hash = 'browser-page-span-e2e-anchor'");
	await expect(page).toHaveURL(/#browser-page-span-e2e-anchor$/);
	await makeMarkedRequest(page, "after-hash-only-change");
});
