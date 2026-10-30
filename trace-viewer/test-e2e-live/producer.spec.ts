import { expect, test } from "playwright-opentelemetry/fixture";
import {
	checkpoint,
	LIVE_TRACE_WORKER_URL,
	markFailed,
	traceIdOf,
} from "./live-session";

// The test being watched. Its project streams it as a live trace, and the
// observer project checks the viewer at each checkpoint.

// oxlint-disable-next-line no-empty-pattern -- Playwright needs the fixtures argument destructured
test.afterEach(({}, testInfo) => {
	if (testInfo.status !== testInfo.expectedStatus) markFailed("producer");
});

test("buys something in the demo shop", async ({ page }) => {
	await test.step("Open the shop", async () => {
		await page.goto(`${LIVE_TRACE_WORKER_URL}/demo/shop`);
		await expect(
			page.getByRole("heading", { name: "Demo shop" }),
		).toBeVisible();
	});
	await checkpoint("shop-opened", traceIdOf(test.info()));

	await test.step("Add to cart", async () => {
		await page.getByRole("button", { name: "Add to cart" }).click();
		await expect(page.getByText("1 item in cart")).toBeVisible();
	});
	await checkpoint("item-added");

	await test.step("Check out", async () => {
		await page.getByRole("button", { name: "Check out" }).click();
		await expect(page.getByText("Order placed: order-1")).toBeVisible();
	});
});
