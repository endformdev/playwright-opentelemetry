import { expect } from "@playwright/test";
import { test } from "../dist/fixture.mjs";

const TRACE_MARKER = "browser-page-span-e2e";

async function makeMarkedDocumentRequest(
	page: import("@playwright/test").Page,
	label: string,
) {
	await page.evaluate(
		`(async () => {
			const url = new URL(location.href);
			url.hash = "";
			url.search = "${TRACE_MARKER}=${label}-" + Date.now();

			await new Promise((resolve, reject) => {
				const iframe = document.createElement("iframe");
				iframe.hidden = true;
				iframe.src = url.href;
				iframe.onload = () => {
					iframe.remove();
					resolve(undefined);
				};
				iframe.onerror = () => {
					iframe.remove();
					reject(new Error("Marked document request failed"));
				};
				document.body.append(iframe);
			});
		})()`,
	);
}

test("playwright.dev browser page navigation trace", async ({ page }) => {
	await page.goto("https://playwright.dev/");
	await expect(page).toHaveURL("https://playwright.dev/");
	await makeMarkedDocumentRequest(page, "home");

	await page.getByRole("link", { name: "Docs" }).first().click();
	await expect(page).toHaveURL(/\/docs\/intro/);
	await makeMarkedDocumentRequest(page, "docs-node");

	await page.goto("https://playwright.dev/python/docs/intro");
	await expect(page).toHaveURL(/\/python\/docs\/intro/);
	await makeMarkedDocumentRequest(page, "docs-python");

	await page.evaluate("location.hash = 'browser-page-span-e2e-anchor'");
	await expect(page).toHaveURL(/#browser-page-span-e2e-anchor$/);
	await makeMarkedDocumentRequest(page, "after-hash-only-change");
});
