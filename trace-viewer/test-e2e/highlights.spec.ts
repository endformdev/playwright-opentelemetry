import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { createScreenshotsZipFromOffsets } from "./screenshot-zip";
import { TraceDataBuilder } from "./test-data-builder";

const FILE = "tests/shop.spec.ts";

const at = (line: number, column: number) => ({
	"code.file.path": FILE,
	"code.line.number": line,
	"code.column.number": column,
});

/** A 4s shopping test, adding to the cart twice in a loop. */
async function createTrace(request: APIRequestContext) {
	const traceId = randomUUID().replaceAll("-", "");
	const testStartTime = Date.now();
	const builder = new TraceDataBuilder(traceId, testStartTime).addTestSpan(
		"Shop",
		4000,
	);
	const open = builder.addStepSpanAndGetId("Open the shop", 300, {
		startOffsetMs: 200,
		attributes: at(5, 3),
	});
	for (const startOffsetMs of [800, 1400]) {
		builder.addStepSpanAndGetId("Add to cart", 400, {
			startOffsetMs,
			attributes: at(8, 5),
		});
	}
	builder.addStepSpanAndGetId("Check out", 600, {
		startOffsetMs: 2200,
		attributes: at(12, 3),
	});
	builder.addStepSpanAndGetId("See receipt", 400, {
		startOffsetMs: 3000,
		attributes: at(15, 3),
	});
	await builder.send(request);

	const zip = await createScreenshotsZipFromOffsets({
		testStartTime,
		screenshotOffsetsMs: Array.from({ length: 16 }, (_, i) => i * 250),
	});
	const upload = await request.put(
		`${TRACE_API_URL}/playwright-otel-reporter/v1/screenshots.zip`,
		{
			data: Buffer.from(await zip.arrayBuffer()),
			headers: { "Content-Type": "application/zip", "X-Trace-Id": traceId },
		},
	);
	expect(upload.ok()).toBeTruthy();
	return { traceId, testStartTime, open };
}

for (const view of ["full", "player"] as const) {
	test(`highlights several steps, opening on the first, in the ${view} view`, async ({
		page,
		request,
	}) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		const { traceId, testStartTime, open } = await createTrace(request);
		const viewer = new TraceViewerPage(page);
		const { stepViewer, ruler } = viewer;

		await viewer.loadTraceFromUrlParam(traceId, {
			view,
			highlight: [
				// Another column, as after an edit: found by its start time
				`time:${testStartTime + 2200}~loc:shop.spec.ts:12:9~label:Checks out`,
				`span:${open}~label:Opens the shop`,
				"span:ffffffffffffffff~label:Not in this trace",
				// The loop's last run, on its start
				`loc:${FILE}:8~at:start~label:Adds to cart again`,
			],
		});

		await expect(ruler.markers).toHaveCount(3, { timeout: 10000 });
		await expect(ruler.markers).toHaveText([
			"Checks out",
			"Opens the shop",
			"Adds to cart again",
		]);
		await expect(ruler.markers.nth(0)).toHaveAttribute("data-time-ms", "2200");
		await expect(ruler.markers.nth(1)).toHaveAttribute("data-time-ms", "200");
		await expect(ruler.markers.nth(2)).toHaveAttribute("data-time-ms", "1400");
		await expect(ruler.markers.nth(2)).not.toHaveAttribute("data-end-ms");
		// Opens on the first highlight's result
		await expect(stepViewer.stepTitle).toHaveText("Check out");
		await expect(stepViewer.position).toHaveText("4/5");
	});

	test(`highlights a step found by its start time and location in the ${view} view`, async ({
		page,
		request,
	}) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		const { traceId, testStartTime } = await createTrace(request);
		const viewer = new TraceViewerPage(page);
		const { stepViewer, ruler } = viewer;

		await viewer.loadTraceFromUrlParam(traceId, {
			view,
			highlight: `time:${testStartTime + 1400}~loc:${FILE}:8:5~label:Adds to cart`,
		});
		await expect(ruler.markers).toHaveText("Adds to cart", { timeout: 10000 });
		await expect(ruler.markers).toHaveAttribute("data-time-ms", "1400");
		await expect(stepViewer.position).toHaveText("3/5");
	});

	test(`shows the trace as usual without highlights it can find in the ${view} view`, async ({
		page,
		request,
	}) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		const { traceId } = await createTrace(request);
		const viewer = new TraceViewerPage(page);
		const { stepViewer, ruler } = viewer;

		await viewer.loadTraceFromUrlParam(traceId, {
			view,
			highlight: ["label:No target", "span:ffffffffffffffff", "loc:other.ts:1"],
		});
		await expect(stepViewer.screenshot).toBeVisible({ timeout: 10000 });
		await expect(stepViewer.position).toHaveText("–/5");
		await expect(ruler.markers).toHaveCount(0);
	});
}
