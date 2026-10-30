import { randomBytes } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "playwright-opentelemetry/fixture";
import { TraceViewerPage } from "../test-e2e/page-objects/trace-viewer-page";
import { LIVE_TRACE_WORKER_URL } from "./live-session";

// Drives the live trace routes directly, one section at a time, so each
// section's first span arrives after the viewer has rendered without it.

test("shows each span section once a live trace has spans for it", async ({
	page,
	request,
}) => {
	const traceId = randomBytes(16).toString("hex");
	const baseUrl = `${LIVE_TRACE_WORKER_URL}/playwright-otel-live/v1/${traceId}`;
	const startTime = Date.now();
	const rootSpanId = randomBytes(8).toString("hex");

	await request.put(`${baseUrl}/start`, {
		data: {
			rootSpanId,
			test: {
				title: "sections",
				file: "sections.spec.ts",
				line: 1,
				describes: [],
				project: "chromium",
			},
			startTime,
		},
	});
	await postSpan(request, baseUrl, {
		serviceName: "playwright-tests",
		traceId,
		parentSpanId: rootSpanId,
		name: "playwright.test.step",
		title: "First step",
		startMs: startTime,
	});

	const viewer = new TraceViewerPage(page);
	await page.goto(`/?traceSource=${encodeURIComponent(baseUrl)}`);
	await expect(viewer.steps.spanByName("First step")).toBeVisible();
	await expect(viewer.browserSpans.root).toHaveCount(0);
	await expect(page.getByTitle("No browser spans were captured")).toBeVisible();

	await postSpan(request, baseUrl, {
		serviceName: "playwright-browser",
		traceId,
		parentSpanId: rootSpanId,
		name: "browser.page",
		startMs: startTime + 100,
	});
	await expect(viewer.browserSpans.spans()).toHaveCount(1);
	await expect(page.getByTitle("No browser spans were captured")).toHaveCount(
		0,
	);

	await postSpan(request, baseUrl, {
		serviceName: "checkout-api",
		traceId,
		parentSpanId: rootSpanId,
		name: "GET /cart",
		startMs: startTime + 200,
	});
	await expect(viewer.externalSpans.spans()).toHaveCount(1);
	await expect(page.getByTitle("No external spans were captured")).toHaveCount(
		0,
	);
	await expect(viewer.steps.spanByName("First step")).toBeVisible();
	await expect(viewer.browserSpans.spans()).toHaveCount(1);
});

async function postSpan(
	request: APIRequestContext,
	baseUrl: string,
	span: {
		serviceName: string;
		traceId: string;
		parentSpanId: string;
		name: string;
		title?: string;
		startMs: number;
	},
): Promise<void> {
	const toNanos = (ms: number) => `${BigInt(ms) * 1_000_000n}`;
	const response = await request.post(`${baseUrl}/spans`, {
		data: {
			resourceSpans: [
				{
					resource: {
						attributes: [
							{ key: "service.name", value: { stringValue: span.serviceName } },
						],
					},
					scopeSpans: [
						{
							scope: { name: "live-trace-e2e", version: "1" },
							spans: [
								{
									traceId: span.traceId,
									spanId: randomBytes(8).toString("hex"),
									parentSpanId: span.parentSpanId,
									name: span.name,
									kind: 1,
									startTimeUnixNano: toNanos(span.startMs),
									endTimeUnixNano: toNanos(span.startMs + 50),
									attributes: span.title
										? [
												{
													key: "test.step.title",
													value: { stringValue: span.title },
												},
											]
										: [],
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
	expect(response.ok()).toBe(true);
}
