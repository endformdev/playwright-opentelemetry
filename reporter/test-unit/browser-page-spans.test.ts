import { beforeEach, describe, expect, it, vi } from "vitest";
import { shouldCreateSameDocumentPageSpan } from "../src/fixture/browser-page-tracker";
import { type BrowserPageAction, runReporterTest } from "./reporter-harness";

vi.mock("../src/reporter/sender", () => ({
	sendSpans: vi.fn(),
}));

import { sendSpans } from "../src/reporter/sender";

const BROWSER_SERVICE_NAME = "playwright-browser" as const;
const BROWSER_PAGE_SPAN_NAME = "browser.page" as const;
const HTTP_CLIENT_SPAN_NAME = "HTTP GET" as const;

interface BrowserPageScenario {
	steps: Array<{
		title: string;
		startTime: Date;
		duration: number;
		browserPageActions: BrowserPageAction[];
	}>;
}

async function runBrowserPageScenario(_scenario: BrowserPageScenario) {
	return runReporterTest({
		test: {
			title: "browser page span scenario",
			titlePath: ["", "chromium", "browser-page.spec.ts", "browser page span scenario"],
		},
		result: {
			steps: _scenario.steps.map((step) => ({
				title: step.title,
				startTime: step.startTime,
				duration: step.duration,
				browserPageActions: step.browserPageActions,
				networkActions: step.browserPageActions.length === 0 ? [
					{
						method: "GET",
						url: "https://example.com/bootstrap.json",
						statusCode: 200,
						startTime: new Date("2025-11-06T10:00:00.200Z"),
						duration: 100,
					},
				] : undefined,
			})),
		},
	});
}

function sentSpans() {
	return (sendSpans as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? [];
}

function findBrowserPageSpan(spans = sentSpans()) {
	return spans.find(
		(span: { name: string; serviceName?: string }) =>
			span.name === BROWSER_PAGE_SPAN_NAME &&
			span.serviceName === BROWSER_SERVICE_NAME,
	);
}

function findHttpSpan(spans = sentSpans()) {
	return spans.find(
		(span: { name: string; serviceName?: string }) =>
			span.name === HTTP_CLIENT_SPAN_NAME &&
			span.serviceName === BROWSER_SERVICE_NAME,
	);
}

describe("PlaywrightOpentelemetryReporter - Browser page spans", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates a browser.page span for a main-frame document navigation", async () => {
		await runBrowserPageScenario({
			steps: [
				{
					title: "Navigate to docs",
					startTime: new Date("2025-11-06T10:00:00.100Z"),
					duration: 500,
					browserPageActions: [
						{
							type: "document",
							url: "https://example.com/docs",
							startTime: new Date("2025-11-06T10:00:00.150Z"),
						},
					],
				},
			],
		});

		const pageSpan = findBrowserPageSpan();

		expect(pageSpan).toEqual(
			expect.objectContaining({
				name: BROWSER_PAGE_SPAN_NAME,
				serviceName: BROWSER_SERVICE_NAME,
				startTime: new Date("2025-11-06T10:00:00.150Z"),
				attributes: expect.objectContaining({
					"url.full": "https://example.com/docs",
					"url.path": "/docs",
					"browser.page.navigation.type": "document",
				}),
			}),
		);
	});

	it("parents document and subresource HTTP spans to the active browser.page span", async () => {
		await runBrowserPageScenario({
			steps: [
				{
					title: "Navigate to product page",
					startTime: new Date("2025-11-06T10:00:00.100Z"),
					duration: 800,
					browserPageActions: [
						{
							type: "document",
							url: "https://example.com/products/123",
							startTime: new Date("2025-11-06T10:00:00.150Z"),
							networkActions: [
								{
									method: "GET",
									url: "https://example.com/products/123",
									statusCode: 200,
									startTime: new Date("2025-11-06T10:00:00.150Z"),
									duration: 120,
								},
								{
									method: "GET",
									url: "https://example.com/app.js",
									statusCode: 200,
									startTime: new Date("2025-11-06T10:00:00.250Z"),
									duration: 200,
								},
							],
						},
					],
				},
			],
		});

		const spans = sentSpans();
		const pageSpan = findBrowserPageSpan(spans);
		const httpSpan = findHttpSpan(spans);

		expect(pageSpan).toBeDefined();
		expect(httpSpan).toEqual(
			expect.objectContaining({
				parentSpanId: pageSpan?.spanId,
			}),
		);
	});

	it("creates a new browser.page span for deliberate same-document SPA navigation", async () => {
		await runBrowserPageScenario({
			steps: [
				{
					title: "Open product details",
					startTime: new Date("2025-11-06T10:00:00.100Z"),
					duration: 800,
					browserPageActions: [
						{
							type: "document",
							url: "https://example.com/products",
							startTime: new Date("2025-11-06T10:00:00.150Z"),
						},
						{
							type: "same-document",
							previousUrl: "https://example.com/products",
							url: "https://example.com/products/123",
							startTime: new Date("2025-11-06T10:00:00.400Z"),
						},
					],
				},
			],
		});

		const pageSpans = sentSpans().filter(
			(span: { name: string; serviceName?: string }) =>
				span.name === BROWSER_PAGE_SPAN_NAME &&
				span.serviceName === BROWSER_SERVICE_NAME,
		);

		expect(pageSpans).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					attributes: expect.objectContaining({
						"url.full": "https://example.com/products/123",
						"browser.page.navigation.type": "same-document",
						"browser.page.previous_url": "https://example.com/products",
					}),
				}),
			]),
		);
	});

	it("does not create a new browser.page span for hash-only scroll updates", () => {
		expect(
			shouldCreateSameDocumentPageSpan(
				"https://example.com/docs#getting-started",
				"https://example.com/docs#api",
				"https://example.com/docs#getting-started",
			),
		).toBe(false);
	});

	it("falls back to the current Playwright step when no active browser.page span exists", async () => {
		await runBrowserPageScenario({
			steps: [
				{
					title: "Seed browser state",
					startTime: new Date("2025-11-06T10:00:00.100Z"),
					duration: 500,
					browserPageActions: [],
				},
			],
		});

		const spans = sentSpans();
		const pageSpan = findBrowserPageSpan(spans);
		const httpSpan = findHttpSpan(spans);

		expect(pageSpan).toBeUndefined();
		expect(httpSpan?.parentSpanId).not.toBeUndefined();
	});

	it("ends a browser.page span at the next page span on the same Playwright page", async () => {
		await runBrowserPageScenario({
			steps: [
				{
					title: "Navigate between pages",
					startTime: new Date("2025-11-06T10:00:00.100Z"),
					duration: 1000,
					browserPageActions: [
						{
							type: "document",
							url: "https://example.com/products",
							startTime: new Date("2025-11-06T10:00:00.150Z"),
						},
						{
							type: "document",
							url: "https://example.com/cart",
							startTime: new Date("2025-11-06T10:00:00.600Z"),
						},
					],
				},
			],
		});

		const pageSpans = sentSpans().filter(
			(span: { name: string; serviceName?: string }) =>
				span.name === BROWSER_PAGE_SPAN_NAME &&
				span.serviceName === BROWSER_SERVICE_NAME,
		);

		expect(pageSpans[0]).toEqual(
			expect.objectContaining({
				endTime: new Date("2025-11-06T10:00:00.600Z"),
			}),
		);
	});
});
