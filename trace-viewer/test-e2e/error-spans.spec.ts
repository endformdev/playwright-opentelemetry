import { readFileSync } from "node:fs";
import {
	type APIRequestContext,
	expect,
	type Locator,
	test,
} from "@playwright/test";
import { TraceViewerPage } from "./page-objects/trace-viewer-page";
import { ERROR_SPANS_TRACE_ID_FILE } from "./setup/global-setup";
import {
	generateTraceId,
	SpanKind,
	TraceDataBuilder,
} from "./test-data-builder";

const LONG_NESTED_TRACE_DURATION_MS = 120_000;
const NESTED_EXPECTATION_START_MS = 61_234;
const NESTED_EXPECTATION_DURATION_MS = 2;
const NESTED_EXPECTATION_END_MS =
	NESTED_EXPECTATION_START_MS + NESTED_EXPECTATION_DURATION_MS;
const NESTED_EXPECTATION_TITLE = "expect order status to be confirmed";
const NESTED_EXPECTATION_ERROR = `expect(received).toBe(expected)

Expected: "confirmed"
Received: "submitted"`;

async function sendLongNestedExpectationErrorTrace(
	request: APIRequestContext,
	traceId: string,
): Promise<{ expectationStepId: string }> {
	const builder = new TraceDataBuilder(traceId, Date.now());

	builder.addTestSpan(
		"long nested expectation error trace",
		LONG_NESTED_TRACE_DURATION_MS,
		{
			status: "failed",
			file: "errors/long-nested-expectation.spec.ts",
			line: 10,
		},
	);

	const checkoutStepId = builder.addStepSpanAndGetId(
		"Complete checkout journey",
		118_000,
		{ startOffsetMs: 1_000 },
	);
	builder.addStepSpanAndGetId("Seed cart with products", 18_000, {
		parentSpanId: checkoutStepId,
		startOffsetMs: 2_000,
	});
	builder.addStepSpanAndGetId("Open checkout page", 16_000, {
		parentSpanId: checkoutStepId,
		startOffsetMs: 21_000,
	});
	const paymentStepId = builder.addStepSpanAndGetId(
		"Submit payment and wait for confirmation",
		48_000,
		{ parentSpanId: checkoutStepId, startOffsetMs: 38_000 },
	);
	const expectationStepId = builder.addStepSpanAndGetId(
		NESTED_EXPECTATION_TITLE,
		NESTED_EXPECTATION_DURATION_MS,
		{
			parentSpanId: paymentStepId,
			startOffsetMs: NESTED_EXPECTATION_START_MS,
			status: { code: 2, message: NESTED_EXPECTATION_ERROR },
		},
	);
	builder.addStepSpanAndGetId(
		"Collect diagnostics after failed checkout",
		28_000,
		{
			parentSpanId: checkoutStepId,
			startOffsetMs: 88_000,
		},
	);

	await builder.send(request);

	return { expectationStepId };
}

async function boundingBoxFor(locator: Locator) {
	const box = await locator.boundingBox();
	if (!box) {
		throw new Error("Expected span bar to have a bounding box");
	}
	return box;
}

test("shows reporter error spans in the header dropdown", async ({ page }) => {
	const traceId = readFileSync(ERROR_SPANS_TRACE_ID_FILE, "utf-8").trim();
	const viewer = new TraceViewerPage(page);

	await viewer.loadTraceFromApi(traceId);
	await expect(viewer.header.testName).toHaveText(
		"expected failing step trace",
	);
	await expect(viewer.header.status).toHaveText("failed");

	const failingStep = viewer.steps.spanByName("Failing checkout step").first();
	await expect(failingStep).toBeVisible();
	await expect(failingStep).toHaveAttribute("data-span-error", "true");

	const spanId = await failingStep.getAttribute("data-span-id");
	expect(spanId).toBeTruthy();

	await expect(viewer.errors.button).toBeVisible();
	await expect(viewer.errors.count).not.toHaveText("0");
	await viewer.errors.button.click();
	await expect(viewer.errors.dropdown).toBeVisible();
	await expect(viewer.errors.dropdown).toContainText("Failing checkout step");
	await expect(viewer.errors.dropdown).toContainText(
		"expect(received).toBe(expected)",
	);
	await expect(viewer.errors.dropdown).not.toContainText(/\[\d+m/);

	await viewer.errors.items
		.filter({ hasText: "Failing checkout step" })
		.first()
		.click();
	const spanDetails = viewer.details.spanDetailsById(spanId!);
	const errorMessage = spanDetails.getByTestId("span-error-message");
	await expect(spanDetails).toBeVisible();
	await expect(spanDetails).toContainText("Error");
	await expect(errorMessage).toContainText("expect(received).toBe(expected)");
	await expect(errorMessage).toContainText('Expected: "confirmed"');
	await expect(errorMessage).toContainText('Received: "submitted"');
	await expect(errorMessage).not.toContainText(/\[\d+m/);
});

test("orders error spans by trace time in the header dropdown", async ({
	page,
	request,
}) => {
	const traceId = generateTraceId("errororder001");
	const builder = new TraceDataBuilder(traceId, Date.now());

	builder.addTestSpan("error ordering trace", 5000, {
		status: "failed",
		file: "errors/order.spec.ts",
		line: 10,
	});
	builder.addStepSpanAndGetId("Late step error", 300, {
		startOffsetMs: 3000,
		status: { code: 2, message: "Late step failure" },
	});
	builder.addCustomSpan({
		serviceName: "playwright-browser",
		scopeName: "playwright-browser",
		name: "Early browser error",
		kind: SpanKind.CLIENT,
		durationMs: 200,
		startOffsetMs: 1000,
		status: { code: 2, message: "Early browser failure" },
	});
	builder.addCustomSpan({
		serviceName: "api-service",
		scopeName: "api",
		name: "Middle external error",
		kind: SpanKind.INTERNAL,
		durationMs: 200,
		startOffsetMs: 2000,
		status: { code: 2, message: "Middle external failure" },
	});

	await builder.send(request);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	await expect(viewer.header.testName).toHaveText("error ordering trace");

	await viewer.errors.button.click();
	await expect(viewer.errors.items).toHaveText([
		/Early browser error.*1\.00s.*Early browser failure.*playwright-browser/,
		/Middle external error.*2\.00s.*Middle external failure.*api-service/,
		/Late step error.*3\.00s.*Late step failure.*playwright-tests/,
	]);
});

test("zooms out when selecting an off-screen error span", async ({
	page,
	request,
}) => {
	const traceId = generateTraceId("errorzoom001");
	const builder = new TraceDataBuilder(traceId, Date.now());

	builder
		.addTestSpan("error zoom trace", 10000, {
			status: "failed",
			file: "errors/zoom.spec.ts",
			line: 10,
		})
		.addCustomSpan({
			serviceName: "api-service",
			scopeName: "api",
			name: "Early failure",
			kind: SpanKind.INTERNAL,
			durationMs: 250,
			startOffsetMs: 500,
			status: { code: 2, message: "Early failure message" },
		});

	for (let i = 0; i < 8; i++) {
		builder.addCustomSpan({
			serviceName: "api-service",
			scopeName: "api",
			name: `Late filler ${i + 1}`,
			kind: SpanKind.INTERNAL,
			durationMs: 1000,
			startOffsetMs: 7000 + i * 250,
		});
	}

	await builder.send(request);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	await expect(viewer.header.testName).toHaveText("error zoom trace");

	const earlyError = viewer.externalSpans.spanByName("Early failure");
	await viewer.timelineContent.dblclick();
	await expect(earlyError).toBeVisible();

	await viewer.zoomTimelineToRange(0.7, 0.95);
	await expect(earlyError).toHaveCount(0);

	await viewer.errors.button.click();
	await viewer.errors.items
		.filter({ hasText: "Early failure" })
		.first()
		.click();

	await expect(earlyError).toBeVisible();
});

test("keeps a selected tiny nested error step locked while zooming into it", async ({
	page,
	request,
}) => {
	const traceId = generateTraceId("nestederrlock001");
	const { expectationStepId } = await sendLongNestedExpectationErrorTrace(
		request,
		traceId,
	);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	await expect(viewer.header.testName).toHaveText(
		"long nested expectation error trace",
	);

	const expectationStep = viewer.steps.spanById(expectationStepId).first();
	await viewer.errors.button.click();
	await viewer.errors.items
		.filter({ hasText: NESTED_EXPECTATION_TITLE })
		.first()
		.click();

	const selectedDetails = viewer.details.spanDetailsById(expectationStepId);
	await expect(selectedDetails).toBeVisible();
	await expect(selectedDetails).toContainText(NESTED_EXPECTATION_TITLE);
	await expect(selectedDetails.getByTestId("span-error-message")).toContainText(
		NESTED_EXPECTATION_ERROR,
	);
	await expect(
		viewer.header.root.getByText(`${NESTED_EXPECTATION_END_MS}ms`, {
			exact: true,
		}),
	).toBeVisible();

	await viewer.zoomTimelineToRange(0.49, 0.53);

	await expect(
		viewer.header.root.getByText(`${NESTED_EXPECTATION_END_MS}ms`, {
			exact: true,
		}),
	).toBeVisible();
	await expect(selectedDetails).toBeVisible();
	await expect(selectedDetails).toContainText(NESTED_EXPECTATION_TITLE);
	await expect(expectationStep).toBeVisible();
});

test("keeps a selected tiny nested error step locked while shift-wheel-zooming away from it", async ({
	page,
	request,
}) => {
	const traceId = generateTraceId("nestederrwheel001");
	const { expectationStepId } = await sendLongNestedExpectationErrorTrace(
		request,
		traceId,
	);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	await expect(viewer.header.testName).toHaveText(
		"long nested expectation error trace",
	);

	const expectationStep = viewer.steps.spanById(expectationStepId).first();
	await viewer.errors.button.click();
	await viewer.errors.items
		.filter({ hasText: NESTED_EXPECTATION_TITLE })
		.first()
		.click();
	await expect(
		viewer.header.root.getByText(`${NESTED_EXPECTATION_END_MS}ms`, {
			exact: true,
		}),
	).toBeVisible();

	const initialBox = await boundingBoxFor(expectationStep);

	await viewer.wheelTimelineAtRatio(0.9, -200, {
		shift: true,
		repeat: 7,
	});

	await expect(expectationStep).toBeVisible();
	const zoomedBox = await boundingBoxFor(expectationStep);
	expect(zoomedBox.width).toBeGreaterThan(initialBox.width);
	await expect(viewer.details.spanDetailsById(expectationStepId)).toBeVisible();
	await expect(
		viewer.header.root.getByText(`${NESTED_EXPECTATION_END_MS}ms`, {
			exact: true,
		}),
	).toBeVisible();
});
