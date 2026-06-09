import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { TraceViewerPage } from "./page-objects/trace-viewer-page";
import { ERROR_SPANS_TRACE_ID_FILE } from "./setup/global-setup";

test("shows reporter error spans in the header dropdown", async ({ page }) => {
	const traceId = readFileSync(ERROR_SPANS_TRACE_ID_FILE, "utf-8").trim();
	const viewer = new TraceViewerPage(page);

	await viewer.loadTraceFromApi(traceId);
	await expect(viewer.header.testName).toHaveText(
		"expected failing step trace",
	);
	await expect(viewer.header.status).toHaveText("failed");

	const failingStep = viewer.steps.spanByName("Failing checkout step").first();
	await expect(failingStep).toBeVisible();
	await expect(failingStep).toHaveAttribute("data-span-error", "true");

	const spanId = await failingStep.getAttribute("data-span-id");
	expect(spanId).toBeTruthy();

	await expect(viewer.errors.button).toBeVisible();
	await expect(viewer.errors.count).not.toHaveText("0");
	await viewer.errors.button.click();
	await expect(viewer.errors.dropdown).toBeVisible();
	await expect(viewer.errors.dropdown).toContainText("Failing checkout step");

	await viewer.errors.items
		.filter({ hasText: "Failing checkout step" })
		.first()
		.click();
	await expect(viewer.details.spanDetailsById(spanId!)).toBeVisible();
	await expect(viewer.details.spanDetailsById(spanId!)).toContainText("Error");
});
