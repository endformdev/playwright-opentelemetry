import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";

const TEST_NAME = "playwright.dev browser page navigation trace";

test("shows a useful error for non-ZIP local files", async ({ page }) => {
	await page.goto("/");

	await page.locator('input[type="file"]').setInputFiles({
		name: "trace.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("not a trace zip"),
	});

	await expect(
		page.getByText("Select a Playwright OpenTelemetry trace ZIP file.").first(),
	).toBeVisible();
	await expect(
		page.getByText("Load a Playwright OpenTelemetry trace"),
	).toBeVisible();
});

test("loads a remote trace ZIP URL from the URL field", async ({ page }) => {
	const viewer = new TraceViewerPage(page);
	await viewer.goto();

	await viewer.loadTraceFromUrl(
		`${TRACE_API_URL}/fixtures/browser-page-spans-trace.zip`,
	);

	await expect(viewer.header.testName).toHaveText(TEST_NAME);
	await expect(viewer.browserSpans.spanByName("/docs/intro")).toBeVisible();
});

test("shows source-specific information when API loading fails", async ({
	page,
}) => {
	const viewer = new TraceViewerPage(page);
	await viewer.goto();

	await viewer.loadTraceFromUrl(
		`${TRACE_API_URL}/playwright-otel-trace-viewer/v1/missing-trace`,
	);

	await expect(page.getByText("Failed to load trace")).toBeVisible();
	await expect(page.getByText(/Failed to fetch trace data/)).toBeVisible();
	await expect(
		page.getByText(
			`${TRACE_API_URL}/playwright-otel-trace-viewer/v1/missing-trace/traces`,
		),
	).toBeVisible();
});
