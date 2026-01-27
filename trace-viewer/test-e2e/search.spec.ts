import { expect, test } from "@playwright/test";
import {
	generateTraceId,
	loadTrace,
	TraceDataBuilder,
} from "./test-data-builder";

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
		await loadTrace(page, traceId);

		// Wait for trace to load
		await expect(page.getByTestId("test-name")).toBeVisible();

		const searchInput = page.getByPlaceholder("Search spans...");
		const keyboardHint = page.locator("kbd").filter({ hasText: "/" });
		const dropdown = page.locator(
			'[data-scope="combobox"][data-part="content"]',
		);

		// 1. Verify search input is visible with keyboard hint
		await expect(searchInput).toBeVisible();
		await expect(keyboardHint).toBeVisible();

		// 2. Click elsewhere to ensure search is not focused, then use "/" shortcut
		await page.getByTestId("test-name").click();
		await expect(searchInput).not.toBeFocused();
		await page.keyboard.press("/");
		await expect(searchInput).toBeFocused();
		await expect(searchInput).toHaveValue(""); // "/" should not be typed
		await expect(keyboardHint).not.toBeVisible(); // hint hides when focused

		// 3. Type search query and verify results appear with highlighting
		await searchInput.fill("GET");
		await page.waitForTimeout(300); // debounce delay

		await expect(dropdown).toBeVisible();
		await expect(dropdown).toContainText("GET");

		// Verify at least one result item is shown
		const resultItems = dropdown.locator(
			'[data-scope="combobox"][data-part="item"]',
		);
		await expect(resultItems.first()).toBeVisible();

		// 4. Press Escape - dropdown closes but text remains
		await page.keyboard.press("Escape");
		await expect(dropdown).not.toBeVisible();
		await expect(searchInput).toHaveValue("GET");

		// 5. Clear with X button (clear button is still visible even with dropdown closed)
		const clearButton = page.getByTestId("search-clear-button");
		await expect(clearButton).toBeVisible();
		await clearButton.click();

		await expect(searchInput).toHaveValue("");
		await expect(dropdown).not.toBeVisible();
	});

	test("handles no results gracefully", async ({ page }) => {
		await loadTrace(page, traceId);

		await expect(page.getByTestId("test-name")).toBeVisible();

		const searchInput = page.getByPlaceholder("Search spans...");
		const dropdown = page.locator(
			'[data-scope="combobox"][data-part="content"]',
		);

		// Type a query that won't match anything
		await searchInput.click();
		await searchInput.fill("zzzznonexistent");
		await page.waitForTimeout(300);

		// Dropdown should show "No results found" message
		await expect(dropdown).toBeVisible();
		await expect(dropdown).toContainText("No results found");

		// No result items should be present
		const resultItems = page.locator(
			'[data-scope="combobox"][data-part="item"]',
		);
		await expect(resultItems).toHaveCount(0);
	});
});
