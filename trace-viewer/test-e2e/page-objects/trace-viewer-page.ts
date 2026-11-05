import { expect, type Locator, type Page } from "@playwright/test";

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

	/** The focused card, marked like any other focused span */
	get focusedCards(): Locator {
		return this.root.locator('[data-focused="true"]');
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

	screenshot(): Locator {
		return this.root.locator("[data-screenshot]");
	}
}

/** The screenshot filmstrip the step ruler opens while it is hovered */
export class RulerFilmstrip {
	readonly root: Locator;
	/** Names what is under the pointer, as in "2. Click · 1.2s" */
	readonly label: Locator;
	/** Shades the time range of the step or hooks under the pointer */
	readonly range: Locator;
	/** The frame under the pointer, one per row */
	readonly framesUnderPointer: Locator;

	constructor(page: Page) {
		this.root = page.getByTestId("ruler-filmstrip");
		this.label = this.root.getByTestId("ruler-filmstrip-label");
		this.range = this.root.getByTestId("ruler-filmstrip-range");
		this.framesUnderPointer = this.root.locator("[data-under-pointer]");
	}

	/** Frames with a screenshot, which carry its timestamp and page */
	screenshots(): Locator {
		return this.root.locator("img[data-screenshot-timestamp]");
	}

	rows(): Locator {
		return this.root.getByTestId("screenshot-row");
	}
}

/** The step ruler: the whole test, its steps along the top, ticks below. */
export class TimelineRulerComponent {
	readonly page: Page;
	readonly root: Locator;
	/** The step bar, which seeks and goes to steps */
	readonly bar: Locator;
	/** One per step viewer stop, in order */
	readonly steps: Locator;
	readonly hooks: Locator;
	/** The playhead knob, carrying the locked time */
	readonly playhead: Locator;
	readonly zoomWindow: Locator;
	readonly filmstrip: RulerFilmstrip;

	constructor(page: Page) {
		this.page = page;
		this.root = page.getByTestId("timeline-ruler");
		this.bar = this.root.getByTestId("step-ruler-bar");
		this.steps = this.root.getByTestId("step-ruler-step");
		this.hooks = this.root.getByTestId("step-ruler-hooks");
		this.playhead = this.root.getByTestId("step-ruler-playhead");
		this.zoomWindow = this.root.getByTestId("ruler-zoom-window");
		this.filmstrip = new RulerFilmstrip(page);
	}

	/** Where on screen a share of the whole test is, on the step bar */
	async pointAt(ratio: number): Promise<{ x: number; y: number }> {
		const plot = await this.bar.boundingBox();
		if (!plot) throw new Error("Step ruler is not visible");
		return { x: plot.x + plot.width * ratio, y: plot.y + plot.height / 2 };
	}

	async hoverAt(ratio: number): Promise<void> {
		const { x, y } = await this.pointAt(ratio);
		await this.page.mouse.move(x, y);
	}

	async clickAt(ratio: number): Promise<void> {
		const { x, y } = await this.pointAt(ratio);
		await this.page.mouse.click(x, y);
	}

	/** Share of the whole test an element's centre sits at */
	async ratioOf(locator: Locator): Promise<number> {
		const [box, plot] = await Promise.all([
			locator.boundingBox(),
			this.bar.boundingBox(),
		]);
		if (!box || !plot) throw new Error("Not visible on the step ruler");
		return (box.x + box.width / 2 - plot.x) / plot.width;
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

/** The step viewer's filmstrip screen, in place of the big screen */
export class PlayerFilmstrip {
	readonly root: Locator;
	/** The hovered frame, zoomed below the player */
	readonly zoom: Locator;
	/** Names the step at the hovered moment, as in "2. Click · 1.2s" */
	readonly zoomCaption: Locator;

	constructor(page: Page) {
		this.root = page.getByTestId("step-viewer-filmstrip");
		this.zoom = page.getByTestId("screenshot-zoom");
		this.zoomCaption = this.zoom.getByTestId("screenshot-zoom-caption");
	}

	rows(): Locator {
		return this.root.getByTestId("screenshot-row");
	}

	row(pageId: string): Locator {
		return this.root.locator(
			`[data-testid="screenshot-row"][data-screenshot-page-id="${pageId}"]`,
		);
	}
}

export class StepViewerComponent {
	/** The player: screenshot, control bar and step ruler */
	readonly root: Locator;
	readonly filmstrip: PlayerFilmstrip;
	/** The area the screenshot fills, above the control bar */
	readonly screen: Locator;
	readonly controlBar: Locator;
	/** Step counter; reads "3/12" on a stop and "–/12" otherwise */
	readonly position: Locator;
	readonly screenshot: Locator;
	/**
	 * The step the viewer is on, named in the control bar; its title
	 * tooltip holds its parents, title and locator, one per line
	 */
	readonly step: Locator;
	readonly stepTitle: Locator;
	readonly stepSubtitle: Locator;
	readonly pagePicker: Locator;
	readonly previousButton: Locator;
	readonly nextButton: Locator;
	readonly playButton: Locator;
	readonly pauseButton: Locator;
	/** Reads the playback speed, as in "2×"; clicking moves to the next one */
	readonly speedButton: Locator;

	constructor(page: Page) {
		this.root = page.getByRole("region", { name: "Step viewer" });
		this.filmstrip = new PlayerFilmstrip(page);
		this.screen = this.root.getByTestId("step-viewer-screen");
		this.controlBar = this.root.getByTestId("player-control-bar");
		this.position = this.root.getByTestId("step-viewer-position");
		this.step = this.root.getByTestId("step-viewer-step");
		this.stepTitle = this.step.getByTestId("step-viewer-step-title");
		this.stepSubtitle = this.step.getByTestId("step-viewer-step-subtitle");
		this.pagePicker = this.root.getByRole("group", { name: "Pages" });
		this.screenshot = this.root.getByRole("img", {
			name: /Step viewer screenshot/,
		});
		const playback = this.root.getByRole("group", { name: "Playback" });
		this.previousButton = playback.getByRole("button", {
			name: "Previous step",
		});
		this.nextButton = playback.getByRole("button", { name: "Next step" });
		this.playButton = playback.getByRole("button", {
			name: "Play",
			exact: true,
		});
		this.pauseButton = playback.getByRole("button", {
			name: "Pause",
			exact: true,
		});
		this.speedButton = playback.getByRole("button", { name: "Playback speed" });
	}

	page(number: number): Locator {
		return this.pagePicker.getByRole("button", {
			name: `Page ${number}`,
			exact: true,
		});
	}
}

export type ViewerSectionLabel =
	| "Step viewer"
	| "Steps timeline"
	| "Browser spans"
	| "External spans";

export class ViewerSettingsMenu {
	readonly page: Page;
	readonly button: Locator;
	readonly menu: Locator;

	constructor(page: Page) {
		this.page = page;
		this.button = page
			.getByTestId("trace-viewer-header")
			.getByRole("button", { name: "Viewer settings" });
		this.menu = page.getByRole("menu");
	}

	item(label: ViewerSectionLabel): Locator {
		return this.page.getByRole("menuitemcheckbox", { name: label });
	}

	/** What the step viewer shows: the big screen or a filmstrip */
	screen(label: "Big screen" | "Filmstrip"): Locator {
		return this.page.getByRole("menuitemradio", { name: label });
	}

	async chooseScreen(label: "Big screen" | "Filmstrip"): Promise<void> {
		await this.open();
		await this.screen(label).click();
		await this.close();
	}

	async open(): Promise<void> {
		if (await this.menu.isVisible()) return;
		await this.button.click();
		// The menu ignores Escape until it has moved focus into itself.
		await expect(this.menu).toBeFocused();
	}

	async close(): Promise<void> {
		await this.page.keyboard.press("Escape");
		await this.menu.waitFor({ state: "hidden" });
		// The trigger keeps focus and would take arrow keys meant for the timeline.
		await this.button.blur();
	}

	/** Flips sections in one visit to the menu, then closes it. */
	async toggle(...labels: ViewerSectionLabel[]): Promise<void> {
		await this.open();
		for (const label of labels) await this.item(label).click();
		await this.close();
	}
}

export class TraceViewerPage {
	readonly page: Page;
	readonly root: Locator;
	readonly header: TraceViewerHeader;
	readonly timelineContent: Locator;
	readonly ruler: TimelineRulerComponent;
	readonly timelineRuler: Locator;
	readonly steps: SpanSection;
	readonly browserSpans: SpanSection;
	readonly externalSpans: SpanSection;
	readonly details: DetailsPanel;
	readonly search: SearchComponent;
	readonly errors: ErrorSpansComponent;
	readonly stepViewer: StepViewerComponent;
	readonly settingsButton: Locator;
	readonly settings: ViewerSettingsMenu;

	constructor(page: Page) {
		this.page = page;
		this.root = page.getByRole("main", { name: "Trace viewer" });
		this.header = new TraceViewerHeader(page);
		this.timelineContent = page.getByRole("region", { name: "Trace timeline" });
		this.ruler = new TimelineRulerComponent(page);
		this.timelineRuler = this.ruler.root;
		this.steps = new SpanSection(page, "Steps Timeline");
		this.browserSpans = new SpanSection(page, "Browser Spans");
		this.externalSpans = new SpanSection(page, "External Spans");
		this.details = new DetailsPanel(page);
		this.search = new SearchComponent(page);
		this.errors = new ErrorSpansComponent(page);
		this.stepViewer = new StepViewerComponent(page);
		this.settingsButton = page
			.getByTestId("trace-viewer-header")
			.getByRole("button", { name: "Viewer settings" });
		this.settings = new ViewerSettingsMenu(page);
	}

	/** Stores viewer settings before the app loads. */
	async useViewerSettings(
		settings: Record<string, boolean | string>,
	): Promise<void> {
		await this.page.addInitScript((stored) => {
			localStorage.setItem("trace-viewer-settings", stored);
		}, JSON.stringify(settings));
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

	async loadTraceFromUrlParam(
		traceIdHex: string,
		extraParams: Record<string, string> = {},
	): Promise<void> {
		const apiUrl = `${TRACE_API_URL}/playwright-otel-trace-viewer/v1/${traceIdHex}`;
		const params = new URLSearchParams({ traceSource: apiUrl, ...extraParams });
		await this.page.goto(`/?${params.toString()}`);
	}

	async zoomTimelineToRange(
		startRatio: number,
		endRatio: number,
	): Promise<void> {
		const box = await this.timelineContent.boundingBox();
		if (!box) {
			throw new Error("Trace timeline is not visible");
		}

		// Off centre: two equal span panels meet in the middle.
		const y = box.y + box.height * 0.4;
		await this.page.mouse.move(box.x + box.width * startRatio, y);
		await this.page.mouse.down();
		await this.page.mouse.move(box.x + box.width * endRatio, y, { steps: 8 });
		await this.page.mouse.up();
	}

	async wheelTimelineAtRatio(
		ratio: number,
		deltaY: number,
		options: { repeat?: number; control?: boolean; shift?: boolean } = {},
	): Promise<void> {
		const box = await this.timelineContent.boundingBox();
		if (!box) {
			throw new Error("Trace timeline is not visible");
		}

		await this.page.mouse.move(
			box.x + box.width * ratio,
			box.y + box.height / 2,
		);
		if (options.control) await this.page.keyboard.down("Control");
		if (options.shift) await this.page.keyboard.down("Shift");
		try {
			for (let i = 0; i < (options.repeat ?? 1); i++) {
				await this.page.mouse.wheel(0, deltaY);
			}
		} finally {
			if (options.shift) await this.page.keyboard.up("Shift");
			if (options.control) await this.page.keyboard.up("Control");
		}
	}
}
