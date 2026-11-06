import { randomUUID } from "node:crypto";
import {
	type APIRequestContext,
	expect,
	type FrameLocator,
	type Locator,
	type Page,
	test,
} from "@playwright/test";
import {
	SpanSection,
	StepViewerComponent,
	TimelineRulerComponent,
	TRACE_API_URL,
	WRANGLER_VIEWER_URL,
} from "./page-objects/trace-viewer-page";
import { createScreenshotsZipFromOffsets } from "./screenshot-zip";
import { TraceDataBuilder } from "./test-data-builder";

const FIRST_CONTENTFUL_OFFSET_MS = 300;

/**
 * A trace that opens on blank frames. The viewer only skips those if it can
 * read the frames back from a canvas, so landing on the first frame with
 * content shows the images didn't taint it.
 */
async function createTrace(request: APIRequestContext) {
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();
	const builder = new TraceDataBuilder(traceId, testStartTime).addTestSpan(
		"Sandboxed",
		2000,
	);
	builder.addStepSpanAndGetId("Open the shop", 1000, { startOffsetMs: 0 });
	builder.addStepSpanAndGetId("Open the cart", 500, { startOffsetMs: 1000 });
	await builder.send(request);

	const zip = await createScreenshotsZipFromOffsets({
		testStartTime,
		screenshotOffsetsMs: [100, 200, FIRST_CONTENTFUL_OFFSET_MS, 1000, 1500],
		blankOffsetsMs: [100, 200],
	});
	const upload = await request.put(
		`${TRACE_API_URL}/playwright-otel-reporter/v1/screenshots.zip`,
		{
			data: Buffer.from(await zip.arrayBuffer()),
			headers: { "Content-Type": "application/zip", "X-Trace-Id": traceId },
		},
	);
	expect(upload.ok()).toBeTruthy();
	return {
		traceId,
		firstContentful: testStartTime + FIRST_CONTENTFUL_OFFSET_MS,
	};
}

function viewerQuery(traceId: string, options: { view?: string } = {}): string {
	return new URLSearchParams({
		traceSource: `${TRACE_API_URL}/playwright-otel-trace-viewer/v1/${traceId}`,
		traceToken: "test-token",
		...options,
	}).toString();
}

/** Hosts the viewer as agent hosts do, without allow-same-origin. */
async function sandboxViewer(page: Page, query: string): Promise<FrameLocator> {
	await page.setViewportSize({ width: 1440, height: 1000 });
	// Not a page made up with page.route, which couldn't frame localhost.
	await page.setContent(
		`<iframe sandbox="allow-scripts allow-forms" src="${WRANGLER_VIEWER_URL}/?${query}" style="width:1400px;height:950px;border:0"></iframe>`,
	);
	return page.frameLocator("iframe");
}

function collectConsoleErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	page.on("pageerror", (error) => errors.push(error.message));
	return errors;
}

function viewerOrigin(frame: FrameLocator): Promise<string> {
	return frame.locator("body").evaluate(() => self.origin);
}

async function expectRendered(image: Locator): Promise<void> {
	await expect
		.poll(() =>
			image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
		)
		.toBeGreaterThan(0);
}

test("a sandboxed viewer shows the trace and its screenshots", async ({
	page,
	request,
}) => {
	const { traceId, firstContentful } = await createTrace(request);
	const errors = collectConsoleErrors(page);
	const frame = await sandboxViewer(page, viewerQuery(traceId));
	const stepViewer = new StepViewerComponent(frame);

	await test.step("The viewer really has an opaque origin", async () => {
		expect(await viewerOrigin(frame)).toBe("null");
	});

	await test.step("The trace loads", async () => {
		const steps = new SpanSection(frame, "Steps Timeline");
		await expect(steps.spanByName("Open the shop")).toBeVisible();
		await expect(steps.spanByName("Open the cart")).toBeVisible();
	});

	await test.step("A screenshot renders, skipping the blank frames", async () => {
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			String(firstContentful),
		);
		await expect(stepViewer.screenshot).toHaveAttribute("src", /^blob:/);
		await expectRendered(stepViewer.screenshot);
	});

	await test.step("The ruler's filmstrip renders too", async () => {
		const ruler = new TimelineRulerComponent(page, frame);
		await ruler.hoverAt(0.5);
		const frames = ruler.filmstrip.screenshots();
		await expect(frames.first()).toBeVisible();
		await expectRendered(frames.first());
	});

	await test.step("Settings change with nowhere to save them, showing the player filmstrip", async () => {
		await frame.getByRole("button", { name: "Viewer settings" }).click();
		await frame.getByRole("menuitemradio", { name: "Filmstrip" }).click();
		await page.keyboard.press("Escape");
		const frames = stepViewer.filmstrip.root.locator("img");
		await expect(frames.first()).toBeVisible();
		await expectRendered(frames.first());
	});

	expect(errors).toEqual([]);
});

test("a sandboxed viewer plays a trace in the player view", async ({
	page,
	request,
}) => {
	const { traceId, firstContentful } = await createTrace(request);
	const errors = collectConsoleErrors(page);
	const frame = await sandboxViewer(
		page,
		viewerQuery(traceId, { view: "player" }),
	);
	const stepViewer = new StepViewerComponent(frame);

	expect(await viewerOrigin(frame)).toBe("null");
	await expect(stepViewer.screenshot).toHaveAttribute(
		"data-screenshot-timestamp",
		String(firstContentful),
	);
	await expectRendered(stepViewer.screenshot);

	await test.step("Stepping swaps in the next frame", async () => {
		await stepViewer.nextButton.click();
		await expect(stepViewer.screenshot).not.toHaveAttribute(
			"data-screenshot-timestamp",
			String(firstContentful),
		);
		await expectRendered(stepViewer.screenshot);
	});

	expect(errors).toEqual([]);
});

test("a sandboxed viewer loads a trace from its form, updating the URL", async ({
	page,
	request,
}) => {
	const { traceId } = await createTrace(request);
	const errors = collectConsoleErrors(page);
	const frame = await sandboxViewer(page, "");

	await frame
		.getByPlaceholder("Enter API URL...")
		.fill(`${TRACE_API_URL}/playwright-otel-trace-viewer/v1/${traceId}`);
	await frame.getByRole("button", { name: "Load" }).click();

	const stepViewer = new StepViewerComponent(frame);
	await expectRendered(stepViewer.screenshot);
	await expect
		.poll(() => frame.locator("body").evaluate(() => location.search))
		.toContain(traceId);
	expect(errors).toEqual([]);
});

test("the production build keeps using its service worker outside a sandbox", async ({
	page,
	request,
}) => {
	const { traceId } = await createTrace(request);
	await page.goto(`${WRANGLER_VIEWER_URL}/?${viewerQuery(traceId)}`);

	const stepViewer = new StepViewerComponent(page);
	await expect(stepViewer.screenshot).toHaveAttribute(
		"src",
		new RegExp(`^/playwright-otel-trace-viewer/v1/${traceId}/screenshots/`),
	);
	await expectRendered(stepViewer.screenshot);
});

test.describe("when a service worker never takes control", () => {
	test.use({ serviceWorkers: "block" });

	test("screenshots fall back to loading in the page", async ({
		page,
		request,
	}) => {
		const { traceId } = await createTrace(request);
		await page.goto(`/?${viewerQuery(traceId)}`);

		const stepViewer = new StepViewerComponent(page);
		await expect(stepViewer.screenshot).toHaveAttribute("src", /^blob:/, {
			timeout: 15000,
		});
		await expectRendered(stepViewer.screenshot);
	});
});
