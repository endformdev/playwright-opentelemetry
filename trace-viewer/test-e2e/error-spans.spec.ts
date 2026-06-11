import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { TraceViewerPage } from "./page-objects/trace-viewer-page";
import { ERROR_SPANS_TRACE_ID_FILE } from "./setup/global-setup";
import { generateTraceId, SpanKind, TraceDataBuilder } from "./test-data-builder";

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
	await expect(viewer.errors.dropdown).toContainText(
		"expect(received).toBe(expected)",
	);
	await expect(viewer.errors.dropdown).not.toContainText(/\[\d+m/);

	await viewer.errors.items
		.filter({ hasText: "Failing checkout step" })
		.first()
		.click();
	const spanDetails = viewer.details.spanDetailsById(spanId!);
	const errorMessage = spanDetails.getByTestId("span-error-message");
	await expect(spanDetails).toBeVisible();
	await expect(spanDetails).toContainText("Error");
	await expect(errorMessage).toContainText("expect(received).toBe(expected)");
	await expect(errorMessage).toContainText('Expected: "confirmed"');
	await expect(errorMessage).toContainText('Received: "submitted"');
	await expect(errorMessage).not.toContainText(/\[\d+m/);
});

test("zooms out when selecting an off-screen error span", async ({
	page,
	request,
}) => {
	const traceId = generateTraceId("errorzoom001");
	const builder = new TraceDataBuilder(traceId, Date.now());

	builder
		.addTestSpan("error zoom trace", 10000, {
			status: "failed",
			file: "errors/zoom.spec.ts",
			line: 10,
		})
		.addCustomSpan({
			serviceName: "api-service",
			scopeName: "api",
			name: "Early failure",
			kind: SpanKind.INTERNAL,
			durationMs: 250,
			startOffsetMs: 500,
			status: { code: 2, message: "Early failure message" },
		});

	for (let i = 0; i < 8; i++) {
		builder.addCustomSpan({
			serviceName: "api-service",
			scopeName: "api",
			name: `Late filler ${i + 1}`,
			kind: SpanKind.INTERNAL,
			durationMs: 1000,
			startOffsetMs: 7000 + i * 250,
		});
	}

	await builder.send(request);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	await expect(viewer.header.testName).toHaveText("error zoom trace");

	const earlyError = viewer.externalSpans.spanByName("Early failure");
	await viewer.timelineContent.dblclick();
	await expect(earlyError).toBeVisible();

	await viewer.zoomTimelineToRange(0.7, 0.95);
	await expect(earlyError).toHaveCount(0);

	await viewer.errors.button.click();
	await viewer.errors.items.filter({ hasText: "Early failure" }).first().click();

	await expect(earlyError).toBeVisible();
});
