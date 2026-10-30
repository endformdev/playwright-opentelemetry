import { expect, test } from "playwright-opentelemetry/fixture";
import { TraceViewerPage } from "../test-e2e/page-objects/trace-viewer-page";
import {
	liveTraceViewerUrl,
	markFailed,
	producerReached,
	releaseProducer,
	staticTraceViewerUrl,
	traceIdOf,
} from "./live-session";

// Watches the producer's live trace in the viewer while the producer runs.
// This test is traced too: its own trace shows the viewer's requests to the
// live trace API and screenshots of what the viewer showed at each step.

// oxlint-disable-next-line no-empty-pattern -- Playwright needs the fixtures argument destructured
test.afterEach(({}, testInfo) => {
	if (testInfo.status !== testInfo.expectedStatus) markFailed("observer");
});

test("watches the producer's live trace while it runs", async ({ page }) => {
	const producerTraceId =
		await test.step("Wait for the producer to open the shop", () =>
			producerReached("shop-opened"));
	const liveUrl = liveTraceViewerUrl(producerTraceId);
	test.info().annotations.push(
		{ type: "Producer live trace", description: liveUrl },
		{
			type: "Observer trace (after the run)",
			description: staticTraceViewerUrl(traceIdOf(test.info())),
		},
	);
	console.log(`Producer live trace: ${liveUrl}`);
	console.log(
		`Observer trace (after the run): ${staticTraceViewerUrl(traceIdOf(test.info()))}`,
	);

	const viewer = new TraceViewerPage(page);
	await page.goto(liveUrl);

	await test.step("Shop opened: the first step is live", async () => {
		await expect(viewer.header.testName).toHaveText(
			"buys something in the demo shop",
		);
		await expect(viewer.header.status).toHaveText("running");
		await expect(page.getByTestId("live-badge")).toBeVisible();
		await expect(viewer.steps.spanByName("Open the shop")).toBeVisible();
		await expect(viewer.steps.spanByName("Add to cart")).toHaveCount(0);
		await expect(viewer.browserSpans.spans().first()).toBeVisible();
		await expect(
			viewer.externalSpans.spanByName("GET /demo/shop"),
		).toBeVisible();
		await expect(viewer.screenshots.images().first()).toBeVisible();
	});
	releaseProducer("shop-opened");

	await test.step("Wait for the producer to add to cart", () =>
		producerReached("item-added"));
	await test.step("Item added: the cart call is live", async () => {
		await expect(viewer.steps.spanByName("Add to cart")).toBeVisible();
		await expect(viewer.steps.spanByName("Check out")).toHaveCount(0);
		await expect(
			viewer.externalSpans.spanByName("POST /demo/api/cart"),
		).toBeVisible();
		await expect(viewer.header.status).toHaveText("running");
	});
	releaseProducer("item-added");

	await test.step("Producer finished: the trace ends", async () => {
		await expect(viewer.steps.spanByName("Check out")).toBeVisible();
		await expect(
			viewer.externalSpans.spanByName("POST /demo/api/checkout"),
		).toBeVisible();
		await expect(viewer.header.status).toHaveText("passed");
		await expect(page.getByTestId("live-badge")).toBeHidden();
	});
});
