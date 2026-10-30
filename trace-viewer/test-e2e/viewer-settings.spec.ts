import { randomUUID } from "node:crypto";
import {
	type APIRequestContext,
	expect,
	type Locator,
	test,
} from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
	type ViewerSectionLabel,
} from "./page-objects/trace-viewer-page";
import { createScreenshotsZipFromOffsets } from "./screenshot-zip";
import { SpanKind, TraceDataBuilder } from "./test-data-builder";

const ALL_SECTIONS: ViewerSectionLabel[] = [
	"Step viewer",
	"Screenshot filmstrip",
	"Steps timeline",
	"Browser spans",
	"External spans",
];
const SPAN_PANELS: ViewerSectionLabel[] = [
	"Steps timeline",
	"Browser spans",
	"External spans",
];

/**
 * A trace with data for every section: screenshots, a step, a browser span
 * and a backend span, all inside the test so each panel has a bar on screen.
 */
async function createTrace(
	request: APIRequestContext,
	options: { externalSpans?: boolean } = {},
): Promise<string> {
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();
	const builder = new TraceDataBuilder(traceId, testStartTime)
		.addTestSpan("Viewer settings", 3000)
		.addStepSpan("Open the app", 400, { startOffsetMs: 100 })
		.addCustomSpan({
			serviceName: "playwright-browser",
			scopeName: "playwright-browser",
			name: "HTTP GET",
			kind: SpanKind.CLIENT,
			attributes: { "http.request.method": "GET" },
			startOffsetMs: 200,
			durationMs: 300,
		});
	if (options.externalSpans ?? true) {
		builder.addCustomSpan({
			serviceName: "api-service",
			scopeName: "api",
			name: "GET /api",
			kind: SpanKind.SERVER,
			startOffsetMs: 250,
			durationMs: 200,
		});
	}
	await builder.send(request);

	const screenshotsZip = await createScreenshotsZipFromOffsets({
		testStartTime,
		screenshotOffsetsMs: [0, 500, 1000, 1500, 2000, 2500],
	});
	const upload = await request.put(
		`${TRACE_API_URL}/playwright-otel-reporter/v1/screenshots.zip`,
		{
			data: Buffer.from(await screenshotsZip.arrayBuffer()),
			headers: { "Content-Type": "application/zip", "X-Trace-Id": traceId },
		},
	);
	expect(upload.ok()).toBeTruthy();
	return traceId;
}

function sectionRoots(
	viewer: TraceViewerPage,
): Record<ViewerSectionLabel, Locator> {
	return {
		"Step viewer": viewer.stepViewer.root,
		"Screenshot filmstrip": viewer.screenshots.root,
		"Steps timeline": viewer.steps.root,
		"Browser spans": viewer.browserSpans.root,
		"External spans": viewer.externalSpans.root,
	};
}

/** Exactly `shown` are on screen, and the menu agrees. */
async function expectSections(
	viewer: TraceViewerPage,
	shown: ViewerSectionLabel[],
): Promise<void> {
	const roots = sectionRoots(viewer);
	for (const label of ALL_SECTIONS) {
		if (shown.includes(label)) {
			await expect(roots[label], `${label} shown`).toBeVisible();
		} else {
			await expect(roots[label], `${label} hidden`).toBeHidden();
		}
	}

	await viewer.settings.open();
	for (const label of ALL_SECTIONS) {
		const item = viewer.settings.item(label);
		if (shown.includes(label)) {
			await expect(item).toBeChecked();
		} else {
			await expect(item).not.toBeChecked();
		}
	}
	await viewer.settings.close();
}

async function loadTrace(
	viewer: TraceViewerPage,
	traceId: string,
): Promise<void> {
	await viewer.loadTraceFromUrlParam(traceId);
	await expect(viewer.header.root).toBeVisible();
	await expect(viewer.timelineContent).toBeVisible();
}

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
});

test("every section is shown by default and listed as checked", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	await loadTrace(viewer, await createTrace(request));

	await expectSections(viewer, ALL_SECTIONS);
});

test("each section hides and comes back on its own", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	await loadTrace(viewer, await createTrace(request));

	for (const label of ALL_SECTIONS) {
		await test.step(label, async () => {
			await viewer.settings.toggle(label);
			await expectSections(
				viewer,
				ALL_SECTIONS.filter((section) => section !== label),
			);
			await viewer.settings.toggle(label);
			await expectSections(viewer, ALL_SECTIONS);
		});
	}
});

test("the menu stays open so several sections can be changed at once", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	await loadTrace(viewer, await createTrace(request));

	await viewer.settings.open();
	await viewer.settings.item("Step viewer").click();
	await expect(viewer.settings.menu).toBeVisible();
	await viewer.settings.item("Browser spans").click();
	await expect(viewer.settings.menu).toBeVisible();
	await viewer.settings.close();

	await expectSections(viewer, [
		"Screenshot filmstrip",
		"Steps timeline",
		"External spans",
	]);
});

test("span panels can be hidden in any combination", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	await loadTrace(viewer, await createTrace(request));
	const screenshotSections: ViewerSectionLabel[] = [
		"Step viewer",
		"Screenshot filmstrip",
	];

	// A Gray-code walk through all eight subsets of the span panels, one
	// toggle at a time, so each change starts from a different set on screen.
	const sequence: ViewerSectionLabel[] = [
		"Browser spans",
		"Steps timeline",
		"Browser spans",
		"External spans",
		"Browser spans",
		"Steps timeline",
		"Browser spans",
	];
	const shown = new Set(SPAN_PANELS);
	for (const label of sequence) {
		await test.step(`Toggle ${label}`, async () => {
			await viewer.settings.toggle(label);
			if (shown.has(label)) shown.delete(label);
			else shown.add(label);
			await expectSections(viewer, [
				...screenshotSections,
				...SPAN_PANELS.filter((panel) => shown.has(panel)),
			]);
			// With every span panel hidden, the ruler and filmstrip remain.
			if (shown.size === 0) await expect(viewer.timelineContent).toBeVisible();
		});
	}

	// The walk ends with only the external spans hidden.
	await viewer.settings.toggle("External spans");
	await expectSections(viewer, ALL_SECTIONS);
});

test("remaining span panels take over the space of hidden ones", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	await loadTrace(viewer, await createTrace(request));
	const heightOf = async (locator: Locator) =>
		(await locator.boundingBox())?.height ?? 0;

	const stepsAlone = await test.step("Hide the other span panels", async () => {
		const before = await heightOf(viewer.steps.root);
		await viewer.settings.toggle("Browser spans", "External spans");
		await expect
			.poll(() => heightOf(viewer.steps.root))
			.toBeGreaterThan(before * 2);
		return heightOf(viewer.steps.root);
	});

	await test.step("Hiding the step viewer gives the timeline more room", async () => {
		await viewer.settings.toggle("Step viewer");
		await expect
			.poll(() => heightOf(viewer.steps.root))
			.toBeGreaterThan(stepsAlone);
	});

	await test.step("Showing a panel again splits the space", async () => {
		const alone = await heightOf(viewer.steps.root);
		await viewer.settings.toggle("Browser spans");
		await expect
			.poll(() => heightOf(viewer.steps.root))
			.toBeLessThan(alone * 0.75);
		await expect
			.poll(() => heightOf(viewer.browserSpans.root))
			.toBeGreaterThan(alone * 0.25);
	});
});

test("settings are remembered across reloads and traces", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	await loadTrace(viewer, await createTrace(request));

	await viewer.settings.toggle("Screenshot filmstrip", "External spans");
	const shown = ALL_SECTIONS.filter(
		(label) => label !== "Screenshot filmstrip" && label !== "External spans",
	);
	await expectSections(viewer, shown);

	await page.reload();
	await expect(viewer.timelineContent).toBeVisible();
	await expectSections(viewer, shown);

	await loadTrace(viewer, await createTrace(request));
	await expectSections(viewer, shown);
});

test("hidden sections are not reported as empty", async ({ page, request }) => {
	const viewer = new TraceViewerPage(page);
	await loadTrace(viewer, await createTrace(request, { externalSpans: false }));
	const noExternalSpans = viewer.emptySection(
		"No external spans were captured",
	);
	const noBrowserSpans = viewer.emptySection("No browser spans were captured");

	// A section without data is listed as empty whatever the settings say.
	await expect(noExternalSpans).toBeVisible();
	await expect(noBrowserSpans).toBeHidden();

	await viewer.settings.toggle("Browser spans", "External spans");
	await expect(viewer.browserSpans.root).toBeHidden();
	await expect(noBrowserSpans).toBeHidden();
	await expect(noExternalSpans).toBeVisible();
});

test("arrow keys only move through span panels that are shown", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	await loadTrace(viewer, await createTrace(request));
	const focusedIn = (panel: Locator) =>
		panel.locator('[data-span-focused="true"]');

	await test.step("With the steps timeline hidden, arrows start in browser spans", async () => {
		await viewer.settings.toggle("Steps timeline");
		await page.keyboard.press("ArrowDown");
		await expect(focusedIn(viewer.browserSpans.root)).toHaveCount(1);
	});

	await test.step("Down skips a hidden browser spans panel", async () => {
		await page.keyboard.press("Escape");
		await viewer.settings.toggle("Steps timeline", "Browser spans");
		// The root test step, then the step beneath it, then past the hidden
		// browser spans to the backend span beneath that.
		await page.keyboard.press("ArrowDown");
		await expect(focusedIn(viewer.steps.root)).toHaveText("Viewer settings");
		await page.keyboard.press("ArrowDown");
		await expect(focusedIn(viewer.steps.root)).toHaveText("Open the app");
		await page.keyboard.press("ArrowDown");
		await expect(focusedIn(viewer.externalSpans.root)).toHaveText("GET /api");
	});
});

test("the step viewer still steps with the steps timeline hidden", async ({
	page,
	request,
}) => {
	const viewer = new TraceViewerPage(page);
	await loadTrace(viewer, await createTrace(request));
	await viewer.settings.toggle("Steps timeline");

	await viewer.stepViewer.root.click();
	await expect(viewer.stepViewer.stepTitle).toHaveText("Open the app");
	await expect(viewer.stepViewer.edge).toHaveText("start");
	await page.keyboard.press("ArrowRight");
	await expect(viewer.stepViewer.edge).toHaveText("end");
	await expect(viewer.details.root).toContainText("Open the app");
});
