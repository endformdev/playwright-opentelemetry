import { expect } from "@playwright/test";
import { test } from "../dist/fixture.mjs";

test("rrweb deterministic state replay", async ({ page }) => {
	await page.setViewportSize({ width: 800, height: 450 });
	await page.goto(
		`data:text/html,${encodeURIComponent(`<!doctype html>
<html>
<head>
	<meta charset="utf-8" />
	<title>rrweb deterministic state replay</title>
	<style>
		html, body {
			margin: 0;
			width: 100%;
			height: 100%;
			font-family: system-ui, sans-serif;
			background: #0f172a;
			color: #f8fafc;
		}
		main {
			display: grid;
			place-items: center;
			width: 100vw;
			height: 100vh;
		}
		#state {
			padding: 48px 64px;
			border: 8px solid #38bdf8;
			border-radius: 24px;
			font-size: 64px;
			font-weight: 800;
			letter-spacing: 0.08em;
			background: #1e293b;
		}
	</style>
</head>
<body>
	<main><div id="state" data-testid="rrweb-state">RRWEB STATE 1</div></main>
	<script>
		const state = document.getElementById("state");
		setTimeout(() => { state.textContent = "RRWEB STATE 2"; }, 1200);
		setTimeout(() => { state.textContent = "RRWEB STATE 3"; }, 2400);
		setTimeout(() => { document.body.dataset.rrwebStable = "state-3"; }, 3200);
	</script>
</body>
</html>`)}`,
	);

	await expect(page.getByTestId("rrweb-state")).toHaveText("RRWEB STATE 1");
	await expect(page.getByTestId("rrweb-state")).toHaveText("RRWEB STATE 2", {
		timeout: 2000,
	});
	await expect(page.getByTestId("rrweb-state")).toHaveText("RRWEB STATE 3", {
		timeout: 2000,
	});
	await expect(page.locator("body")).toHaveAttribute(
		"data-rrweb-stable",
		"state-3",
		{ timeout: 2000 },
	);
	await page.waitForTimeout(1200);
});
