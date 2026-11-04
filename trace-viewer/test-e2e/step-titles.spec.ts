import { expect, test } from "@playwright/test";
import { TraceViewerPage } from "./page-objects/trace-viewer-page";
import { generateTraceId, TraceDataBuilder } from "./test-data-builder";

test("step cards and bars show what a step did apart from what it acted on", async ({
	page,
	request,
}) => {
	const traceId = generateTraceId("steptitles");
	const builder = new TraceDataBuilder(traceId, Date.now()).addTestSpan(
		"Step titles",
		3000,
	);
	const steps = [
		{
			// Recorded by the reporter with Playwright's subtitle
			id: builder.addStepSpanAndGetId("Click", 400, {
				startOffsetMs: 100,
				attributes: {
					"test.step.category": "pw:api",
					"test.step.subtitle": "getByRole('button', { name: 'Upgrade' })",
				},
			}),
			title: "Click",
			subtitle: "getByRole('button', { name: 'Upgrade' })",
		},
		{
			// Recorded before subtitles: the locator is part of the title
			id: builder.addStepSpanAndGetId(
				`Expect "toBeVisible" getByText('No active subscription')`,
				400,
				{
					startOffsetMs: 1000,
					attributes: { "test.step.category": "expect" },
				},
			),
			title: `Expect "toBeVisible"`,
			subtitle: "getByText('No active subscription')",
		},
		{
			id: builder.addStepSpanAndGetId("Verify current plan is Free", 400, {
				startOffsetMs: 2000,
				attributes: { "test.step.category": "test.step" },
			}),
			title: "Verify current plan is Free",
			subtitle: null,
		},
	];
	await builder.send(request);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	const details = page.getByTestId("trace-details-panel");

	for (const step of steps) {
		const bar = viewer.steps.spanById(step.id);
		await expect(bar).toHaveAttribute(
			"data-span-name",
			step.subtitle ? `${step.title} ${step.subtitle}` : step.title,
		);
		await bar.click();

		const card = details.locator(`[data-span-id="${step.id}"]`);
		await expect(card.getByTestId("span-details-title")).toHaveText(step.title);
		if (step.subtitle) {
			await expect(card.getByTestId("span-details-subtitle")).toHaveText(
				step.subtitle,
			);
		} else {
			await expect(card.getByTestId("span-details-subtitle")).toHaveCount(0);
		}
	}
});
