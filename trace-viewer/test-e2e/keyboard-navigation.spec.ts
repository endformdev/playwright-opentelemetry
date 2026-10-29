import { expect, type Page, test } from "@playwright/test";
import { TraceViewerPage } from "./page-objects/trace-viewer-page";
import {
	generateTraceId,
	SpanKind,
	TraceDataBuilder,
} from "./test-data-builder";

interface FocusedBar {
	name: string;
	region: string;
	row: number;
	/** Bar width as a fraction of the timeline plot */
	widthFraction: number;
	/** Whether the whole bar lies inside the timeline plot */
	inPlot: boolean;
	/** Whether the whole bar lies inside its panel's scroll area */
	inScrollArea: boolean;
}

async function focusedBar(page: Page): Promise<FocusedBar | null> {
	return page.evaluate(() => {
		const bars = document.querySelectorAll<HTMLElement>(
			'[role="listitem"][data-span-focused="true"]',
		);
		if (bars.length !== 1) return null;
		const bar = bars[0];
		const plot = document
			.querySelector("[data-timeline-plot]")!
			.getBoundingClientRect();
		const scroller = bar.closest('[role="list"]')!.getBoundingClientRect();
		const box = bar.getBoundingClientRect();
		return {
			name: bar.dataset.spanName!,
			region: bar
				.closest(
					'[role="region"][aria-label]:not([aria-label="Trace timeline"])',
				)!
				.getAttribute("aria-label")!,
			row: Number(bar.dataset.spanRow),
			widthFraction: box.width / plot.width,
			inPlot: box.left >= plot.left - 1 && box.right <= plot.right + 1,
			inScrollArea:
				box.top >= scroller.top - 1 && box.bottom <= scroller.bottom + 1,
		};
	});
}

/** Waits for one focused bar, fully visible in the plot and its panel. */
async function expectFocused(
	page: Page,
	expected: { name: string; region?: string },
): Promise<FocusedBar> {
	await expect
		.poll(async () => {
			const bar = await focusedBar(page);
			return (
				bar && {
					name: bar.name,
					region: bar.region,
					inPlot: bar.inPlot,
					inScrollArea: bar.inScrollArea,
				}
			);
		})
		.toEqual({
			name: expected.name,
			region: expected.region ?? "Steps Timeline",
			inPlot: true,
			inScrollArea: true,
		});
	return (await focusedBar(page))!;
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
	expect(
		await page.evaluate(() => ({
			scrollX: window.scrollX,
			overflow:
				document.scrollingElement!.scrollWidth -
				document.scrollingElement!.clientWidth,
		})),
	).toEqual({ scrollX: 0, overflow: 0 });
}

// Steps (10s test):
// row 0: test                                                   [0, 10000]
// row 1: Before Hooks [100,1600]  Open page [2000,4000]  Verify [5000,8000]  After Hooks [9000,9900]
// row 2: Fixture [200,1400]       Click [2990,3010]  Fill [3200,3800]   Assert [5500,7500]  Teardown [9480,9600]
// Browser: "Click request" [2995, 3055] under Click, "Assert request" [6300, 6700]
// Open page is centered on Click, so moving down from it lands on Click.
async function sendNavigationTrace(
	page: Page,
	request: Parameters<TraceDataBuilder["send"]>[0],
	prefix: string,
) {
	const builder = new TraceDataBuilder(
		generateTraceId(prefix),
		Date.now(),
	).addTestSpan("Keyboard navigation", 10000);
	const beforeHooks = builder.addStepSpanAndGetId("Before Hooks", 1500, {
		startOffsetMs: 100,
	});
	builder.addStepSpanAndGetId("Fixture", 1200, {
		startOffsetMs: 200,
		parentSpanId: beforeHooks,
	});
	const openPage = builder.addStepSpanAndGetId("Open page", 2000, {
		startOffsetMs: 2000,
	});
	const click = builder.addStepSpanAndGetId("Click", 20, {
		startOffsetMs: 2990,
		parentSpanId: openPage,
	});
	builder.addStepSpanAndGetId("Fill", 600, {
		startOffsetMs: 3200,
		parentSpanId: openPage,
	});
	const verify = builder.addStepSpanAndGetId("Verify", 3000, {
		startOffsetMs: 5000,
	});
	builder.addStepSpanAndGetId("Assert", 2000, {
		startOffsetMs: 5500,
		parentSpanId: verify,
	});
	const afterHooks = builder.addStepSpanAndGetId("After Hooks", 900, {
		startOffsetMs: 9000,
	});
	builder.addStepSpanAndGetId("Teardown", 120, {
		startOffsetMs: 9480,
		parentSpanId: afterHooks,
	});
	for (const [name, startOffsetMs, durationMs] of [
		["Click request", 2995, 60],
		["Assert request", 6300, 400],
	] as const) {
		builder.addCustomSpan({
			serviceName: "playwright-browser",
			scopeName: "playwright-browser",
			name,
			kind: SpanKind.CLIENT,
			startOffsetMs,
			durationMs,
		});
	}
	await builder.send(request);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(builder.getTraceId());
	await expect(viewer.header.testName).toHaveText("Keyboard navigation");
	await expect(viewer.steps.spanByName("Open page")).toBeVisible();
	return { viewer, ids: { beforeHooks, openPage, click, verify } };
}

test("arrow keys start at the root test step without scrolling the page", async ({
	page,
	request,
}) => {
	await sendNavigationTrace(page, request, "kbdnavstart");
	await expectNoHorizontalScroll(page);

	await page.keyboard.press("ArrowRight");
	await expectFocused(page, { name: "Keyboard navigation" });
	await expectNoHorizontalScroll(page);

	await page.keyboard.press("ArrowLeft");
	await expectFocused(page, { name: "Keyboard navigation" });
	await expectNoHorizontalScroll(page);
});

test("left and right hop along a row and frame each span within tolerance", async ({
	page,
	request,
}) => {
	const { viewer, ids } = await sendNavigationTrace(page, request, "kbdnavrow");

	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowDown");
	await expectFocused(page, { name: "Verify" });

	await page.keyboard.press("ArrowLeft");
	await expectFocused(page, { name: "Open page" });
	await page.keyboard.press("ArrowLeft");
	const beforeHooks = await expectFocused(page, { name: "Before Hooks" });
	expect(beforeHooks.widthFraction).toBeGreaterThanOrEqual(0.14);
	expect(beforeHooks.widthFraction).toBeLessThanOrEqual(0.61);

	// The focused step is visible in the timeline and the details panel.
	await expect(viewer.steps.spanById(ids.beforeHooks)).toHaveClass(
		/ring-gray-900/,
	);
	await expect(viewer.details.spanDetailsById(ids.beforeHooks)).toHaveClass(
		/ring-blue-200/,
	);

	for (const name of ["Open page", "Verify", "After Hooks"]) {
		await page.keyboard.press("ArrowRight");
		const bar = await expectFocused(page, { name });
		expect(bar.widthFraction).toBeGreaterThanOrEqual(0.14);
		expect(bar.widthFraction).toBeLessThanOrEqual(0.61);
	}
	await page.keyboard.press("ArrowRight");
	await expectFocused(page, { name: "After Hooks" });

	// Hopping to a much smaller span on the next row zooms in on it.
	await page.keyboard.press("Escape");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowLeft");
	await expectFocused(page, { name: "Open page" });
	await page.keyboard.press("ArrowDown");
	const click = await expectFocused(page, { name: "Click" });
	expect(click.widthFraction).toBeGreaterThanOrEqual(0.14);
	expect(click.widthFraction).toBeLessThanOrEqual(0.61);
	await expect(viewer.details.spanDetailsById(ids.click)).toHaveClass(
		/ring-blue-200/,
	);
	await expectNoHorizontalScroll(page);
});

test("down moves into what is beneath and up retraces it", async ({
	page,
	request,
}) => {
	const { viewer } = await sendNavigationTrace(page, request, "kbdnavvert");
	const lockedTime = (ms: number) =>
		viewer.header.root.getByText(`${ms}ms`, { exact: true });

	// The root's center (5000ms) is where Verify starts.
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowDown");
	await expectFocused(page, { name: "Verify" });
	await expect(lockedTime(5000)).toBeVisible();

	// Nothing is under the line at 5000ms, but Assert is beneath Verify: the
	// line moves just far enough to land on it.
	await page.keyboard.press("ArrowDown");
	await expectFocused(page, { name: "Assert" });
	await expect(lockedTime(5500)).toBeVisible();

	// Down crosses into the browser panel the same way.
	await page.keyboard.press("ArrowDown");
	await expectFocused(page, {
		name: "Assert request",
		region: "Browser Spans",
	});
	await expect(lockedTime(6300)).toBeVisible();
	await page.keyboard.press("ArrowDown");
	await expectFocused(page, {
		name: "Assert request",
		region: "Browser Spans",
	});

	// Up retraces the same bars back to the root without moving the line.
	for (const name of ["Assert", "Verify", "Keyboard navigation"]) {
		await page.keyboard.press("ArrowUp");
		await expectFocused(page, { name });
	}
	await page.keyboard.press("ArrowUp");
	await expectFocused(page, { name: "Keyboard navigation" });
	await expect(lockedTime(6300)).toBeVisible();
});

test("down picks a child next to the line when the line falls in a gap", async ({
	page,
	request,
}) => {
	const { viewer } = await sendNavigationTrace(page, request, "kbdnavgap");

	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowRight");
	await expectFocused(page, { name: "After Hooks" });
	await expect(
		viewer.header.root.getByText("9450ms", { exact: true }),
	).toBeVisible();

	// After Hooks' center is just before Teardown starts.
	await page.keyboard.press("ArrowDown");
	await expectFocused(page, { name: "Teardown" });
	await expect(
		viewer.header.root.getByText("9480ms", { exact: true }),
	).toBeVisible();
});

test("clicking a span then using arrows continues from that span", async ({
	page,
	request,
}) => {
	const { viewer } = await sendNavigationTrace(page, request, "kbdnavclick");

	await viewer.steps.spanByName("Open page").click();
	await expectFocused(page, { name: "Open page" });

	await page.keyboard.press("ArrowRight");
	await expectFocused(page, { name: "Verify" });

	await page.keyboard.press("Escape");
	await expect(page.locator("[data-span-focused]")).toHaveCount(0);
});

test("the details panel parent button focuses and frames the parent", async ({
	page,
	request,
}) => {
	const { viewer, ids } = await sendNavigationTrace(
		page,
		request,
		"kbdnavparent",
	);

	await page.keyboard.press("Escape");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.press("ArrowDown");
	await expectFocused(page, { name: "Click" });

	await viewer.details.parentButtonForSpanId(ids.click, ids.openPage).click();
	const parent = await expectFocused(page, { name: "Open page" });
	expect(parent.widthFraction).toBeGreaterThanOrEqual(0.14);
	expect(parent.widthFraction).toBeLessThanOrEqual(0.61);
	await expect(viewer.details.spanDetailsById(ids.openPage)).toHaveClass(
		/ring-blue-200/,
	);
});

test("arrow keys typed into search do not move timeline focus", async ({
	page,
	request,
}) => {
	const { viewer } = await sendNavigationTrace(page, request, "kbdnavsearch");

	await page.keyboard.press("ArrowRight");
	await expectFocused(page, { name: "Keyboard navigation" });

	await viewer.search.input.fill("Assert");
	await expect(viewer.search.resultItems.first()).toBeVisible();
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowRight");
	await expect
		.poll(async () => (await focusedBar(page))?.name)
		.toBe("Keyboard navigation");
});

test("vertical navigation scrolls the focused bar into view", async ({
	page,
	request,
}) => {
	const builder = new TraceDataBuilder(
		generateTraceId("kbdnavscroll"),
		Date.now(),
	).addTestSpan("Deep browser rows", 4000);
	builder.addStepSpanAndGetId("Load", 3000, { startOffsetMs: 500 });
	// Overlapping requests stack into one row each.
	for (let index = 0; index < 20; index++) {
		builder.addCustomSpan({
			serviceName: "playwright-browser",
			scopeName: "playwright-browser",
			name: `Request ${index}`,
			kind: SpanKind.CLIENT,
			startOffsetMs: 1000 + index * 10,
			durationMs: 1500,
		});
	}
	await builder.send(request);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(builder.getTraceId());
	await expect(viewer.header.testName).toHaveText("Deep browser rows");
	await expect(viewer.browserSpans.spanByName("Request 0")).toBeVisible();

	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowDown");
	await expectFocused(page, { name: "Load" });
	for (let index = 0; index < 20; index++) {
		await page.keyboard.press("ArrowDown");
		await expectFocused(page, {
			name: `Request ${index}`,
			region: "Browser Spans",
		});
	}
	for (let index = 18; index >= 0; index--) {
		await page.keyboard.press("ArrowUp");
		await expectFocused(page, {
			name: `Request ${index}`,
			region: "Browser Spans",
		});
	}
	await expectNoHorizontalScroll(page);
});
