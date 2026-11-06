import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { generateTraceId, TraceDataBuilder } from "./test-data-builder";

const TEST_NAME = "playwright.dev browser page navigation trace";

test("shows a useful error for non-ZIP local files", async ({ page }) => {
	await page.goto("/");

	await page.locator('input[type="file"]').setInputFiles({
		name: "trace.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("not a trace zip"),
	});

	await expect(
		page.getByText("Select a Playwright OpenTelemetry trace ZIP file.", {
			exact: true,
		}),
	).toHaveCount(1);
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
	await expect(page.getByPlaceholder("Enter API URL...")).toHaveValue(
		`${TRACE_API_URL}/playwright-otel-trace-viewer/v1/missing-trace`,
	);
	await expect(page.getByText("Drop trace ZIP file here")).toBeVisible();
	await expect(
		page.getByText(
			`${TRACE_API_URL}/playwright-otel-trace-viewer/v1/missing-trace/traces`,
		),
	).toBeVisible();
});

test("lets a typo in the API URL be corrected after a 404", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	const traceId = generateTraceId("aa11bb22cc33dd44ee55ff66");
	const typoTraceId = `${traceId.slice(0, -1)}9`;
	const traceName = "Trace URL typo can be corrected";

	await new TraceDataBuilder(traceId, Date.now())
		.addTestSpan(traceName)
		.addStepSpan("Corrected typo")
		.send(request);

	await viewer.goto();
	await viewer.loadTraceFromUrl(
		`${TRACE_API_URL}/playwright-otel-trace-viewer/v1/${typoTraceId}`,
	);

	await expect(page.getByText("Failed to load trace")).toBeVisible();
	await expect(page.getByPlaceholder("Enter API URL...")).toHaveValue(
		`${TRACE_API_URL}/playwright-otel-trace-viewer/v1/${typoTraceId}`,
	);

	await viewer.loadTraceFromUrl(
		`${TRACE_API_URL}/playwright-otel-trace-viewer/v1/${traceId}`,
	);

	await expect(viewer.header.testName).toHaveText(traceName);
});

test.describe("when the trace API refuses access", () => {
	test.use({ locale: "en-GB", timezoneId: "UTC" });

	function refusedTraceUrl(code: string): string {
		const params = new URLSearchParams({
			traceSource: `${TRACE_API_URL}/fixtures/refused-trace/${code}`,
			traceToken: "secret-token",
		});
		return `/?${params}`;
	}

	test("an expired link says when it expired, and another trace can still be loaded", async ({
		page,
	}) => {
		await page.goto(refusedTraceUrl("token_expired"));

		await expect(
			page.getByRole("heading", { name: "This trace link has expired" }),
		).toBeVisible();
		await expect(page.getByText("6 Nov 2026, 11:53 UTC")).toBeVisible();
		await expect(page.getByText("Ask for a new link")).toBeVisible();
		await expect(page.getByText("Failed to load trace")).toHaveCount(0);
		await expect(page.getByPlaceholder("Enter API URL...")).toHaveCount(0);
		await expect(page.locator("body")).not.toContainText("secret-token");

		await page.getByRole("button", { name: "Load a different trace" }).click();

		await expect(page.getByPlaceholder("Enter API URL...")).toHaveValue("");
		await expect(page).not.toHaveURL(/traceToken/);

		await page.goBack();

		await expect(
			page.getByRole("heading", { name: "This trace link has expired" }),
		).toBeVisible();
	});

	for (const [code, title] of [
		["token_invalid", "This trace link isn't valid"],
		["token_wrong_trace", "This link is for a different trace"],
		["token_missing", "You don't have access to this trace"],
	]) {
		test(`${code} gets its own page`, async ({ page }) => {
			await page.goto(refusedTraceUrl(code));

			await expect(page.getByRole("heading", { name: title })).toBeVisible();
			await expect(page.getByText("Failed to load trace")).toHaveCount(0);
		});
	}

	test("a reason the viewer doesn't know falls back to the load form", async ({
		page,
	}) => {
		await page.goto(refusedTraceUrl("token_stolen"));

		await expect(page.getByText("Failed to load trace")).toBeVisible();
		await expect(page.getByPlaceholder("Enter API URL...")).toBeVisible();
	});
});
