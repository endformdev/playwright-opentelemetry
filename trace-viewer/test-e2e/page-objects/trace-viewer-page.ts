import type { Locator, Page } from "@playwright/test";

export const TRACE_API_URL = "http://localhost:9295";

const spanAttributes = {
	id: "data-span-id",
	name: "data-span-name",
	startMs: "data-span-start-ms",
	durationMs: "data-span-duration-ms",
	endMs: "data-span-end-ms",
	row: "data-span-row",
} as const;

export interface SpanBarData {
	id: string;
	name: string;
	startMs: number;
	durationMs: number;
	endMs: number;
	row: number;
}

function numberAttribute(locator: Locator, name: string): Promise<number> {
	return locator.getAttribute(name).then((value) => {
		if (value === null) {
			throw new Error(`Missing ${name} attribute`);
		}
		return Number(value);
	});
}

export class TraceViewerHeader {
	readonly root: Locator;
	readonly testName: Locator;
	readonly describes: Locator;
	readonly fileLocation: Locator;
	readonly status: Locator;

	constructor(page: Page) {
		this.root = page.getByTestId("trace-viewer-header");
		this.testName = this.root.getByTestId("test-name");
		this.describes = this.root.getByTestId("test-describes");
		this.fileLocation = this.root.getByTestId("test-file-location");
		this.status = this.root.getByTestId("test-status");
	}
}

export class SpanSection {
	readonly root: Locator;
	readonly header: Locator;

	constructor(page: Page, name: string) {
		this.root = page.getByRole("region", { name });
		this.header = this.root.getByText(name, { exact: true });
	}

	spans(): Locator {
		return this.root.getByRole("listitem");
	}

	spanByName(name: string): Locator {
		return this.root.getByRole("listitem", { name, exact: true });
	}

	spanById(id: string): Locator {
		return this.root.locator(`[data-span-id="${id}"]`);
	}

	async spanData(name: string): Promise<SpanBarData> {
		return this.dataFor(this.spanByName(name).first());
	}

	async spanDataById(id: string): Promise<SpanBarData> {
		return this.dataFor(this.spanById(id).first());
	}

	async spanTiming(
		name: string,
	): Promise<Pick<SpanBarData, "startMs" | "durationMs" | "endMs">> {
		const data = await this.spanData(name);
		return {
			startMs: data.startMs,
			durationMs: data.durationMs,
			endMs: data.endMs,
		};
	}

	async allSpanData(): Promise<SpanBarData[]> {
		const spans = this.spans();
		const count = await spans.count();
		const data: SpanBarData[] = [];
		for (let i = 0; i < count; i++) {
			data.push(await this.dataFor(spans.nth(i)));
		}
		return data;
	}

	private async dataFor(locator: Locator): Promise<SpanBarData> {
		const [id, name, startMs, durationMs, endMs, row] = await Promise.all([
			locator.getAttribute(spanAttributes.id),
			locator.getAttribute(spanAttributes.name),
			numberAttribute(locator, spanAttributes.startMs),
			numberAttribute(locator, spanAttributes.durationMs),
			numberAttribute(locator, spanAttributes.endMs),
			numberAttribute(locator, spanAttributes.row),
		]);

		if (id === null || name === null) {
			throw new Error("Missing span identity attributes");
		}

		return { id, name, startMs, durationMs, endMs, row };
	}
}

export class DetailsPanel {
	readonly root: Locator;

	constructor(page: Page) {
		this.root = page.getByTestId("trace-details-panel");
	}

	spanDetailsById(id: string): Locator {
		return this.root.locator(`[data-span-id="${id}"]`);
	}

	parentButtonForSpan(spanId: string, parentName: string): Locator {
		return this.spanDetailsById(spanId).getByRole("button", {
			name: parentName,
			exact: true,
		});
	}

	parentButtonForSpanId(spanId: string, parentSpanId: string): Locator {
		return this.spanDetailsById(spanId).locator(
			`button[data-parent-span-id="${parentSpanId}"]`,
		);
	}
}

export class ScreenshotSection {
	readonly root: Locator;

	constructor(page: Page) {
		this.root = page.getByRole("region", { name: "Screenshots" });
	}

	images(): Locator {
		return this.root.getByRole("img", { name: /Screenshot at/ });
	}

	screenshots(): Locator {
		return this.root.locator("[data-screenshot-timestamp]");
	}
}

export class SearchComponent {
	readonly input: Locator;
	readonly keyboardHint: Locator;
	readonly clearButton: Locator;
	readonly dropdown: Locator;
	readonly resultItems: Locator;

	constructor(page: Page) {
		this.input = page.getByPlaceholder("Search spans...");
		this.keyboardHint = page.locator("kbd").filter({ hasText: "/" });
		this.clearButton = page.getByRole("button", { name: "Clear search" });
		this.dropdown = page.locator(
			'[data-scope="combobox"][data-part="content"]',
		);
		this.resultItems = page.locator(
			'[data-scope="combobox"][data-part="item"]',
		);
	}
}

export class ErrorSpansComponent {
	readonly button: Locator;
	readonly count: Locator;
	readonly dropdown: Locator;
	readonly items: Locator;

	constructor(page: Page) {
		this.button = page.getByTestId("error-spans-button");
		this.count = page.getByTestId("error-spans-count");
		this.dropdown = page.getByTestId("error-spans-dropdown");
		this.items = page.getByTestId("error-spans-item");
	}
}

export class TraceViewerPage {
	readonly page: Page;
	readonly root: Locator;
	readonly header: TraceViewerHeader;
	readonly timelineContent: Locator;
	readonly screenshots: ScreenshotSection;
	readonly steps: SpanSection;
	readonly browserSpans: SpanSection;
	readonly externalSpans: SpanSection;
	readonly details: DetailsPanel;
	readonly search: SearchComponent;
	readonly errors: ErrorSpansComponent;

	constructor(page: Page) {
		this.page = page;
		this.root = page.getByRole("main", { name: "Trace viewer" });
		this.header = new TraceViewerHeader(page);
		this.timelineContent = page.getByRole("region", { name: "Trace timeline" });
		this.screenshots = new ScreenshotSection(page);
		this.steps = new SpanSection(page, "Steps Timeline");
		this.browserSpans = new SpanSection(page, "Browser Spans");
		this.externalSpans = new SpanSection(page, "External Spans");
		this.details = new DetailsPanel(page);
		this.search = new SearchComponent(page);
		this.errors = new ErrorSpansComponent(page);
	}

	async goto(): Promise<void> {
		await this.page.goto("/");
	}

	async loadTraceFromApi(traceIdHex: string): Promise<void> {
		await this.goto();
		await this.loadTraceFromUrl(
			`${TRACE_API_URL}/playwright-otel-trace-viewer/v1/${traceIdHex}`,
		);
	}

	async loadTraceFromUrl(url: string): Promise<void> {
		await this.page.getByPlaceholder("Enter API URL...").fill(url);
		await this.page.getByRole("button", { name: "Load" }).click();
	}

	async loadTraceFromZip(zipPath: string): Promise<void> {
		await this.goto();
		await this.page.locator('input[type="file"]').setInputFiles(zipPath);
	}

	async loadTraceFromUrlParam(traceIdHex: string): Promise<void> {
		const apiUrl = `${TRACE_API_URL}/playwright-otel-trace-viewer/v1/${traceIdHex}`;
		await this.page.goto(`/?traceSource=${encodeURIComponent(apiUrl)}`);
	}

	async zoomTimelineToRange(startRatio: number, endRatio: number): Promise<void> {
		const box = await this.timelineContent.boundingBox();
		if (!box) {
			throw new Error("Trace timeline is not visible");
		}

		const y = box.y + box.height / 2;
		await this.page.mouse.move(box.x + box.width * startRatio, y);
		await this.page.mouse.down();
		await this.page.mouse.move(box.x + box.width * endRatio, y, { steps: 8 });
		await this.page.mouse.up();
	}
}
