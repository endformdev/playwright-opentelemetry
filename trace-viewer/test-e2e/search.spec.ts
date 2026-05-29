import { expect, test } from "@playwright/test";
import { generateTraceId, TraceDataBuilder } from "./test-data-builder";
import { TraceViewerPage } from "./page-objects/trace-viewer-page";

test.describe("Search Functionality", () => {
	test.describe.configure({ mode: "serial" });

	const traceId = generateTraceId("searchtest001");
	let startTime: number;

	test.beforeAll(async ({ request }) => {
		startTime = Date.now();

		const builder = new TraceDataBuilder(traceId, startTime);

		builder
			.addTestSpan("Search functionality test")
			.addStepSpan("Navigate to login page")
			.addStepSpan("Fill login form")
			.addStepSpan("Submit credentials")
			.addHttpSpan("GET", "https://playwright.dev/docs")
			.addHttpSpan("GET", "https://playwright.dev/api")
			.addHttpSpan("POST", "https://api.example.com/auth")
			.addHttpSpan("GET", "https://cdn.example.com/assets")
			.addServerSpan("POST /api/auth", "/api/auth")
			.addDbSpan("DB query users", "postgresql");

		await builder.send(request);
		await builder.sendTestJson(request, {
			name: "Search functionality test",
			status: "passed",
			describes: ["Search", "Basic Search"],
			file: "search/basic-search.spec.ts",
			line: 10,
		});
	});

	test("complete search interaction flow", async ({ page }) => {
		const viewer = new TraceViewerPage(page);
		await viewer.loadTraceFromApi(traceId);

		// Wait for trace to load
		await expect(viewer.header.testName).toHaveText(
			"Search functionality test",
		);

		// 1. Verify search input is visible with keyboard hint
		await expect(viewer.search.input).toBeVisible();
		await expect(viewer.search.keyboardHint).toBeVisible();

		// 2. Click elsewhere to ensure search is not focused, then use "/" shortcut
		await viewer.header.testName.click();
		await expect(viewer.search.input).not.toBeFocused();
		await page.keyboard.press("/");
		await expect(viewer.search.input).toBeFocused();
		await expect(viewer.search.input).toHaveValue(""); // "/" should not be typed
		await expect(viewer.search.keyboardHint).not.toBeVisible(); // hint hides when focused

		// 3. Type search query and verify results appear with highlighting
		await viewer.search.input.fill("GET");
		await page.waitForTimeout(300); // debounce delay

		await expect(viewer.search.dropdown).toBeVisible();
		await expect(viewer.search.dropdown).toContainText("GET");

		// Verify at least one result item is shown
		await expect(viewer.search.resultItems.first()).toBeVisible();

		// 4. Press Escape - dropdown closes but text remains
		await page.keyboard.press("Escape");
		await expect(viewer.search.dropdown).not.toBeVisible();
		await expect(viewer.search.input).toHaveValue("GET");

		// 5. Clear with X button (clear button is still visible even with dropdown closed)
		await expect(viewer.search.clearButton).toBeVisible();
		await viewer.search.clearButton.click();

		await expect(viewer.search.input).toHaveValue("");
		await expect(viewer.search.dropdown).not.toBeVisible();
	});

	test("handles no results gracefully", async ({ page }) => {
		const viewer = new TraceViewerPage(page);
		await viewer.loadTraceFromApi(traceId);

		await expect(viewer.header.testName).toHaveText(
			"Search functionality test",
		);

		// Type a query that won't match anything
		await viewer.search.input.click();
		await viewer.search.input.fill("zzzznonexistent");
		await page.waitForTimeout(300);

		// Dropdown should show "No results found" message
		await expect(viewer.search.dropdown).toBeVisible();
		await expect(viewer.search.dropdown).toContainText("No results found");

		// No result items should be present
		await expect(viewer.search.resultItems).toHaveCount(0);
	});
});
