import { expect, test } from "@playwright/test";
import { TraceViewerPage } from "./page-objects/trace-viewer-page";
import { generateTraceId, TraceDataBuilder } from "./test-data-builder";

test("only the focused card opens by default; the others open on demand", async ({
	page,
	request,
}) => {
	const traceId = generateTraceId("detailscollapse");
	const builder = new TraceDataBuilder(traceId, Date.now()).addTestSpan(
		"Details collapse",
		3000,
	);
	const groupId = builder.addStepSpanAndGetId("Checkout", 2000, {
		startOffsetMs: 200,
	});
	const clickId = builder.addStepSpanAndGetId("Click", 400, {
		startOffsetMs: 600,
		parentSpanId: groupId,
	});
	await builder.send(request);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	await expect(page.getByText("Loading trace data...")).toBeHidden();

	await viewer.steps.spanById(clickId).click();

	const focused = viewer.details.spanDetailsById(clickId);
	await expect(focused).toHaveAttribute("data-expanded", "true");
	await expect(focused.getByTestId("span-details-body")).toBeVisible();
	// The focused card can't be collapsed
	await expect(focused.locator("[aria-expanded]")).toHaveCount(0);

	const group = viewer.details.spanDetailsById(groupId);
	await expect(group).toHaveAttribute("data-expanded", "false");
	await expect(group.getByTestId("span-details-body")).toHaveCount(0);
	await expect(group.getByTestId("span-details-header")).toContainText("2.00s");

	const groupHeader = group.getByRole("button", { expanded: false });
	await groupHeader.click();
	await expect(group).toHaveAttribute("data-expanded", "true");
	await expect(group.getByTestId("span-details-body")).toContainText(
		"Duration:",
	);
	// Opening a card leaves the selection where it was
	await expect(focused).toHaveClass(/ring-blue-200/);

	// A card opened by hand stays open as the selection moves away and back.
	// Click Checkout at 800ms, while Click is still running.
	const groupBar = viewer.steps.spanById(groupId);
	const groupBox = (await groupBar.boundingBox())!;
	await groupBar.click({
		position: { x: groupBox.width * 0.3, y: groupBox.height / 2 },
	});
	await expect(group).toHaveClass(/ring-blue-200/);
	await expect(focused).toHaveAttribute("data-expanded", "false");
	await viewer.steps.spanById(clickId).click();
	await expect(group).toHaveAttribute("data-expanded", "true");

	await group.getByRole("button", { expanded: true }).click();
	await expect(group).toHaveAttribute("data-expanded", "false");
});
