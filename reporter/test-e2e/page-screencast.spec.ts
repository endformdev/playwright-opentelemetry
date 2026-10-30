import { existsSync } from "node:fs";
import { expect } from "@playwright/test";
import { test } from "../dist/fixture.mjs";

// The fixture captures screenshots through page.screencast, which Playwright
// allows once per page. A test's own screencast must keep working.
test("test can run its own page screencast", async ({ page }, testInfo) => {
	await page.setContent(pageHtml("before", "#fee2e2"));

	const frameTimestamps: number[] = [];
	await page.screencast.start({
		onFrame: ({ timestamp }) => {
			frameTimestamps.push(timestamp);
		},
	});
	await page.setContent(pageHtml("during", "#dbeafe"));
	await expect.poll(() => frameTimestamps.length).toBeGreaterThan(0);
	await page.screencast.stop();

	const videoPath = testInfo.outputPath("screencast.webm");
	await page.screencast.start({ path: videoPath });
	await page.setContent(pageHtml("recording", "#dcfce7"));
	await page.waitForTimeout(250);
	await page.screencast.stop();
	expect(existsSync(videoPath)).toBe(true);

	await page.setContent(pageHtml("after", "#fef3c7"));
	await expect(page.getByText("after")).toBeVisible();
});

function pageHtml(label: string, background: string): string {
	return `<main style="background:${background};height:100vh;display:grid;place-items:center;font:32px sans-serif"><h1>${label}</h1></main>`;
}
