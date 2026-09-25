import { expect, test } from "@playwright/test";
import { TraceViewerPage } from "./page-objects/trace-viewer-page";
import { generateTraceId, TraceDataBuilder } from "./test-data-builder";

test("direct span hits stay focused at edges, after locking, and across plot sizes", async ({
	page,
	request,
}) => {
	const traceId = generateTraceId("hoveraccuracy");
	const builder = new TraceDataBuilder(traceId, Date.now()).addTestSpan(
		"Hover accuracy",
		10000,
	);
	const ids = [
		builder.addStepSpanAndGetId("Early", 50, { startOffsetMs: 100 }),
		builder.addStepSpanAndGetId("Late", 50, { startOffsetMs: 9800 }),
		builder.addStepSpanAndGetId("Tiny", 1, { startOffsetMs: 9900 }),
	];
	await builder.send(request);
	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	await expect(page.getByText("Loading trace data...")).toBeHidden();
	await expect(page.getByText("Screenshots", { exact: true })).toBeVisible();
	// Unlocking must use both the current hit and its time, not the old lock.
	await viewer.steps.root.locator(`[data-span-id="${ids[0]}"]`).click();
	await viewer.steps.root.locator(`[data-span-id="${ids[1]}"]`).hover();
	await page.keyboard.press("Escape");
	await expect(
		page
			.getByTestId("trace-details-panel")
			.locator(`[data-span-id="${ids[0]}"]`),
	).toHaveCount(0);
	await expect(
		page
			.getByTestId("trace-details-panel")
			.locator(`[data-span-id="${ids[1]}"]`),
	).toHaveClass(/ring-blue-200/);
	for (const width of [1280, 900]) {
		await page.setViewportSize({ width, height: 800 });
		for (const id of ids) {
			const bar = viewer.steps.root.locator(`[data-span-id="${id}"]`);
			await expect(bar).toBeVisible();
			const box = (await bar.boundingBox())!;
			for (const x of [Math.ceil(box.x), Math.ceil(box.x + box.width) - 1]) {
				await page.mouse.move(x, box.y + box.height / 2);
				expect(
					await page.evaluate(
						({ x, y }) =>
							document
								.elementFromPoint(x, y)
								?.closest("[data-span-id]")
								?.getAttribute("data-span-id"),
						{ x: x, y: box.y + box.height / 2 },
					),
					`DOM hit at ${width}px, ${id}, ${x}`,
				).toBe(id);
				const card = page
					.getByTestId("trace-details-panel")
					.locator(`[data-span-id="${id}"]`);
				await expect(card).toBeVisible();
				await expect(card).toHaveClass(/ring-blue-200/);
			}
			await page.mouse.down();
			await page.mouse.up();
			await page.mouse.move(10, 10);
			const card = page
				.getByTestId("trace-details-panel")
				.locator(`[data-span-id="${id}"]`);
			await expect(card).toHaveClass(/ring-blue-200/);
			await page.mouse.move(Math.ceil(box.x), box.y + box.height / 2);
			await page.keyboard.down("Control");
			await page.mouse.wheel(0, -500);
			await page.keyboard.up("Control");
			await expect(card).toHaveClass(/ring-blue-200/);
			await viewer.timelineContent.dblclick({ position: { x: 100, y: 200 } });
			await bar.hover();
			await expect(card).toHaveClass(/ring-blue-200/);
		}
		const plot = await page.locator("[data-timeline-plot]").boundingBox();
		const late = await viewer.steps.root
			.locator(`[data-span-id="${ids[1]}"]`)
			.boundingBox();
		expect(late!.x).toBeCloseTo(plot!.x + plot!.width * 0.98, 0);
		// Panels stay full width; only the plotted content is inset.
		const timeline = (await viewer.timelineContent.boundingBox())!;
		const steps = (await viewer.steps.root.boundingBox())!;
		expect(steps.x).toBeCloseTo(timeline.x, 0);
		expect(steps.width).toBeCloseTo(timeline.width, 0);
		expect(plot!.x).toBeGreaterThan(timeline.x);
		// Empty space must not retain the last bar's identity or lock it again.
		await page.mouse.click(plot!.x + plot!.width * 0.5, late!.y + 70);
		await expect(
			page.getByTestId("trace-details-panel").locator(".ring-blue-200"),
		).toHaveCount(0);
		await page.keyboard.press("Escape");
	}
});
