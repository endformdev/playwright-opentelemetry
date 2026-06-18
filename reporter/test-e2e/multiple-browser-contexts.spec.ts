import { expect } from "@playwright/test";
import { test } from "../dist/fixture.mjs";

test("multiple browser contexts screenshot trace", async ({ browser }) => {
	const contextA = await browser.newContext({
		viewport: { width: 640, height: 360 },
	});
	const contextB = await browser.newContext({
		viewport: { width: 640, height: 360 },
	});

	try {
		const pageA = await contextA.newPage();
		const pageB = await contextB.newPage();

		await pageA.setContent(pageHtml("context-a-1", "#fee2e2"));
		await pageA.waitForTimeout(250);
		await pageB.setContent(pageHtml("context-b-1", "#dbeafe"));
		await pageB.waitForTimeout(250);
		await pageB.setContent(pageHtml("context-b-2", "#dcfce7"));
		await pageB.waitForTimeout(250);
		await pageA.setContent(pageHtml("context-a-2", "#fef3c7"));
		await pageA.waitForTimeout(250);
		await pageB.setContent(pageHtml("context-b-3", "#ede9fe"));
		await pageB.waitForTimeout(250);

		await expect(pageA.getByText("context-a-2")).toBeVisible();
		await expect(pageB.getByText("context-b-3")).toBeVisible();
	} finally {
		await contextB.close();
		await contextA.close();
	}
});

function pageHtml(label: string, background: string): string {
	return `<main style="background:${background};height:100vh;display:grid;place-items:center;font:32px sans-serif"><h1>${label}</h1></main>`;
}
