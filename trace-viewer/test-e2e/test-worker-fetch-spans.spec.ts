import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { TEST_WORKER_FETCH_TRACE_ID_FILE } from "./setup/global-setup";

interface OtlpAttribute {
	key: string;
	value: {
		stringValue?: string;
		intValue?: number;
		doubleValue?: number;
		boolValue?: boolean;
	};
}

interface OtlpSpan {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	kind: number;
	attributes: OtlpAttribute[];
	status?: { code: number; message?: string };
}

interface OtlpExport {
	resourceSpans: Array<{
		resource: { attributes: OtlpAttribute[] };
		scopeSpans: Array<{
			spans: OtlpSpan[];
		}>;
	}>;
}

interface SpanWithService extends OtlpSpan {
	serviceName: string;
}

test("renders test worker fetch fixture spans from the reporter API flow", async ({
	page,
	request,
}) => {
	const traceId = readFileSync(TEST_WORKER_FETCH_TRACE_ID_FILE, "utf-8").trim();
	const spans = await loadTraceSpans(request, traceId);
	const testSpan = requiredSpan(
		spans,
		"playwright.test root span",
		(span) => span.name === "playwright.test",
	);
	const fetchSpan = requiredSpan(
		spans,
		"test worker fetch span",
		(span) => {
			const attrs = attributes(span);
			return (
				span.name === "HTTP GET" &&
				span.serviceName === "playwright-tests" &&
				attrs["url.path"] === "/fixture-fetch" &&
				attrs["url.query"] === "source=test-worker"
			);
		},
	);

	expect(fetchSpan.kind).toBe(3);
	expect(fetchSpan.parentSpanId).toBe(testSpan.spanId);
	expect(fetchSpan.status).toEqual({ code: 0 });
	expect(attributes(fetchSpan)).toEqual(
		expect.objectContaining({
			"http.request.method": "GET",
			"http.response.status_code": 202,
			"server.address": "127.0.0.1",
			"url.path": "/fixture-fetch",
			"url.query": "source=test-worker",
		}),
	);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);

	await expect(viewer.header.testName).toHaveText("test worker fetch fixture trace");
	await expect(viewer.externalSpans.root).toBeVisible();
	await expect(viewer.externalSpans.spanById(fetchSpan.spanId)).toBeVisible();
	await expect(viewer.browserSpans.spanById(fetchSpan.spanId)).toHaveCount(0);
});

async function loadTraceSpans(
	request: import("@playwright/test").APIRequestContext,
	traceId: string,
): Promise<SpanWithService[]> {
	const response = await request.get(
		`${TRACE_API_URL}/playwright-otel-trace-viewer/v1/${traceId}/traces`,
	);
	expect(response.ok()).toBeTruthy();

	return flattenSpans((await response.json()) as OtlpExport);
}

function flattenSpans(otlpExport: OtlpExport): SpanWithService[] {
	return otlpExport.resourceSpans.flatMap((resourceSpan) => {
		const serviceName = String(
			attributes({ attributes: resourceSpan.resource.attributes })["service.name"] ??
				"unknown",
		);
		return resourceSpan.scopeSpans.flatMap((scopeSpan) =>
			scopeSpan.spans.map((span) => ({ ...span, serviceName })),
		);
	});
}

function requiredSpan(
	spans: SpanWithService[],
	description: string,
	predicate: (span: SpanWithService) => boolean,
): SpanWithService {
	const span = spans.find(predicate);
	if (!span) {
		const found = spans
			.map((span) => {
				const attrs = attributes(span);
				return `${span.serviceName} ${span.name} ${String(attrs["url.path"] ?? "")} ${String(attrs["url.query"] ?? "")} ${String(attrs["url.full"] ?? "")}`;
			})
			.join("\n");
		throw new Error(`Missing ${description}. Found spans:\n${found}`);
	}
	return span;
}

function attributes(span: Pick<OtlpSpan, "attributes">): Record<string, string | number | boolean> {
	return Object.fromEntries(
		span.attributes.flatMap((attribute) => {
			const value = attributeValue(attribute);
			return value === undefined ? [] : [[attribute.key, value]];
		}),
	);
}

function attributeValue(
	attribute: OtlpAttribute,
): string | number | boolean | undefined {
	return (
		attribute.value.stringValue ??
		attribute.value.intValue ??
		attribute.value.doubleValue ??
		attribute.value.boolValue
	);
}
