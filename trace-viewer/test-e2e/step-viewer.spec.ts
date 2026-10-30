import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { createScreenshotsZipFromOffsets } from "./screenshot-zip";
import { TraceDataBuilder } from "./test-data-builder";

test("steps through the test body one step boundary at a time", async ({
	page,
	request,
}) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();

	const builder = new TraceDataBuilder(traceId, testStartTime).addTestSpan(
		"Step viewer",
		4000,
	);
	const beforeHooks = builder.addStepSpanAndGetId("Before Hooks", 500, {
		startOffsetMs: 0,
	});
	builder.addStepSpanAndGetId("Navigate in beforeEach", 400, {
		startOffsetMs: 0,
		parentSpanId: beforeHooks,
	});
	const login = builder.addStepSpanAndGetId("Login", 1200, {
		startOffsetMs: 600,
	});
	const fill = builder.addStepSpanAndGetId("Fill username", 300, {
		startOffsetMs: 600,
		parentSpanId: login,
	});
	const click = builder.addStepSpanAndGetId("Click login", 500, {
		startOffsetMs: 1000,
		parentSpanId: login,
	});
	const check = builder.addStepSpanAndGetId("Check dashboard", 500, {
		startOffsetMs: 2000,
	});
	builder.addStepSpanAndGetId("After Hooks", 400, { startOffsetMs: 3500 });
	await builder.send(request);

	const screenshotsZip = await createScreenshotsZipFromOffsets({
		testStartTime,
		screenshotOffsetsMs: [100, 700, 850, 1200, 3600],
	});
	const upload = await request.put(
		`${TRACE_API_URL}/playwright-otel-reporter/v1/screenshots.zip`,
		{
			data: Buffer.from(await screenshotsZip.arrayBuffer()),
			headers: { "Content-Type": "application/zip", "X-Trace-Id": traceId },
		},
	);
	expect(upload.ok()).toBeTruthy();

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	const { stepViewer } = viewer;
	const focusRing = viewer.root.locator('[data-span-focused="true"]');

	const expectStop = async (
		position: string,
		title: string,
		edge: "start" | "end",
		stepId: string,
		screenshotOffsetMs: number,
	) => {
		await expect(stepViewer.position).toHaveText(position);
		await expect(stepViewer.stepTitle).toHaveText(title);
		await expect(stepViewer.edge).toHaveText(edge);
		await expect(stepViewer.screenshot).toHaveAttribute(
			"data-screenshot-timestamp",
			String(testStartTime + screenshotOffsetMs),
		);
		await expect(viewer.details.spanDetailsById(stepId)).toBeVisible();
		// The caption marks the stop; the focus ring is for span navigation.
		await expect(focusRing).toHaveCount(0);
	};

	/** The first step's bar width as a share of the timeline plot. */
	const focusedStepShare = async () => {
		const bar = await viewer.steps.spanById(fill).boundingBox();
		const plot = await page.locator("[data-timeline-plot]").boundingBox();
		return bar && plot ? bar.width / plot.width : 0;
	};

	await test.step("Loading selects the start of the first test body step without zooming", async () => {
		await expectStop("1/6", "Fill username", "start", fill, 100);
		await expect(stepViewer.root).toContainText("Login ›");
		// Stepping frames a step to at least 15% of the plot; loading keeps the
		// overview, where this step takes about 8%.
		expect(await focusedStepShare()).toBeLessThan(0.12);
	});

	await test.step("Arrow keys step without clicking the viewer first", async () => {
		await page.keyboard.press("ArrowRight");
		await expectStop("2/6", "Fill username", "end", fill, 850);
		await expect.poll(focusedStepShare).toBeGreaterThan(0.14);
		await page.keyboard.press("ArrowRight");
		await expectStop("3/6", "Click login", "start", click, 850);
		await page.keyboard.press("ArrowRight");
		await expectStop("4/6", "Click login", "end", click, 1200);
		await page.keyboard.press("End");
		await expectStop("6/6", "Check dashboard", "end", check, 1200);
		await page.keyboard.press("ArrowRight");
		await expect(stepViewer.position).toHaveText("6/6");
		await page.keyboard.press("ArrowLeft");
		await expectStop("5/6", "Check dashboard", "start", check, 1200);
		await page.keyboard.press("Home");
		await expectStop("1/6", "Fill username", "start", fill, 100);
	});

	await test.step("Leaving the stops for span navigation shows the focus ring", async () => {
		await page.keyboard.press("ArrowUp");
		await expect(stepViewer.caption).toBeHidden();
		await expect(focusRing).toHaveAttribute("data-span-id", login);
	});

	await test.step("The caption only shows while on a stop", async () => {
		await page.keyboard.press("Escape");
		await expect(stepViewer.caption).toBeHidden();
		await expect(focusRing).toHaveCount(0);
	});

	await test.step("Clicking the viewer selects the first stop again", async () => {
		await stepViewer.root.click();
		await expectStop("1/6", "Fill username", "start", fill, 100);
	});

	await test.step("The step viewer can be hidden from settings", async () => {
		await viewer.settingsButton.click();
		await page.getByRole("menuitemcheckbox", { name: "Step viewer" }).click();
		await expect(stepViewer.root).toBeHidden();
		await page.keyboard.press("Escape");

		await page.reload();
		await viewer.loadTraceFromApi(traceId);
		await expect(viewer.header.root).toBeVisible();
		await expect(viewer.screenshots.root).toBeVisible();
		await expect(stepViewer.root).toBeHidden();
	});
});
