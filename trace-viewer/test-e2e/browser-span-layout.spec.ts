import { expect, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { generateTraceId, SpanKind } from "./test-data-builder";

test("keeps nested browser spans visually below their parents", async ({
	page,
	request,
}) => {
	const traceIdHex = generateTraceId("browserlayout01");
	const testStartTime = Date.now();
	const testEndTime = testStartTime + 10_000;
	const parentSpanId = "browserparent01";
	const childSpanId = "browserchild001";

	await request.post(`${TRACE_API_URL}/v1/traces`, {
		data: {
			resourceSpans: [
				{
					resource: {
						attributes: [
							{
								key: "service.name",
								value: { stringValue: "playwright-tests" },
							},
						],
					},
					scopeSpans: [
						{
							scope: { name: "playwright", version: "1.50.0" },
							spans: [
								{
									traceId: traceIdHex,
									spanId: "testroot000001",
									name: "playwright.test",
									kind: SpanKind.INTERNAL,
									startTimeUnixNano: `${testStartTime}000000`,
									endTimeUnixNano: `${testEndTime}000000`,
									attributes: [
										{
											key: "test.case.title",
											value: { stringValue: "Browser span layout test" },
										},
										{
											key: "playwright.test.status",
											value: { stringValue: "passed" },
										},
										{
											key: "code.file.path",
											value: { stringValue: "browser-span-layout.spec.ts" },
										},
										{
											key: "code.line.number",
											value: { intValue: 1 },
										},
									],
									status: { code: 1 },
									events: [],
									links: [],
								},
							],
						},
					],
				},
				{
					resource: {
						attributes: [
							{
								key: "service.name",
								value: { stringValue: "playwright-browser" },
							},
						],
					},
					scopeSpans: [
						{
							scope: { name: "playwright-browser", version: "1.0" },
							spans: [
								{
									traceId: traceIdHex,
									spanId: parentSpanId,
									name: "browser.page",
									kind: SpanKind.INTERNAL,
									startTimeUnixNano: `${testStartTime + 5000}000000`,
									endTimeUnixNano: `${testStartTime + 9000}000000`,
									attributes: [
										{
											key: "browser.resource.type",
											value: { stringValue: "page" },
										},
										{
											key: "url.path",
											value: { stringValue: "/app/new-org" },
										},
									],
									status: { code: 1 },
									events: [],
									links: [],
								},
								{
									traceId: traceIdHex,
									spanId: childSpanId,
									parentSpanId,
									name: "HTTP GET",
									kind: SpanKind.CLIENT,
									startTimeUnixNano: `${testStartTime + 4500}000000`,
									endTimeUnixNano: `${testStartTime + 5300}000000`,
									attributes: [
										{
											key: "http.request.method",
											value: { stringValue: "GET" },
										},
										{
											key: "http.resource.type",
											value: { stringValue: "script" },
										},
										{
											key: "url.path",
											value: { stringValue: "/app/assets/index.js" },
										},
									],
									status: { code: 1 },
									events: [],
									links: [],
								},
							],
						},
					],
				},
			],
		},
	});

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceIdHex);

	await expect(viewer.header.testName).toHaveText("Browser span layout test");
	await expect(viewer.browserSpans.spanById(parentSpanId)).toBeVisible();
	await expect(viewer.browserSpans.spanById(childSpanId)).toBeVisible();

	const parent = await viewer.browserSpans.spanDataById(parentSpanId);
	const child = await viewer.browserSpans.spanDataById(childSpanId);

	expect(child.row).toBeGreaterThan(parent.row);

	const childBar = viewer.browserSpans.spanById(childSpanId);
	const childBox = await childBar.boundingBox();
	if (!childBox) {
		throw new Error("Expected child browser span to be visible");
	}

	await childBar.click({
		position: { x: childBox.width * 0.75, y: childBox.height / 2 },
	});

	const parentButton = viewer.details.parentButtonForSpanId(
		childSpanId,
		parentSpanId,
	);
	await expect(parentButton).toBeVisible();
	await expect(parentButton).toHaveCSS("background-color", "rgb(116, 132, 245)");
});
