import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { NATIVE_API_REQUEST_TRACE_ID_FILE } from "./setup/global-setup";

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

test("renders native Playwright request fixture spans from the reporter API flow", async ({
	page,
	request,
}) => {
	const traceId = readFileSync(
		NATIVE_API_REQUEST_TRACE_ID_FILE,
		"utf-8",
	).trim();
	const spans = await loadTraceSpans(request, traceId);
	const testSpan = requiredSpan(
		spans,
		"playwright.test root span",
		(span) => span.name === "playwright.test",
	);
	const getSpan = requiredNativeRequestSpan(spans, "GET", "source=get");
	const postSpan = requiredNativeRequestSpan(spans, "POST", "source=post");
	expect(duplicateNativeRequestStepSpans(spans, "GET", "source=get")).toEqual(
		[],
	);
	expect(duplicateNativeRequestStepSpans(spans, "POST", "source=post")).toEqual(
		[],
	);

	expect(getSpan.kind).toBe(3);
	expect(postSpan.kind).toBe(3);
	expect(getSpan.parentSpanId).toBe(testSpan.spanId);
	expect(postSpan.parentSpanId).toBe(testSpan.spanId);
	expect(getSpan.status).toEqual({ code: 0 });
	expect(postSpan.status).toEqual({ code: 0 });
	expect(attributes(getSpan)).toEqual(
		expect.objectContaining({
			"http.request.method": "GET",
			"http.response.status_code": 203,
			"http.resource.type": "fetch",
			"playwright.request.api": true,
			"server.address": "127.0.0.1",
			"url.path": "/native-request",
			"url.query": "source=get",
		}),
	);
	expect(attributes(postSpan)).toEqual(
		expect.objectContaining({
			"http.request.method": "POST",
			"http.response.status_code": 201,
			"http.resource.type": "fetch",
			"playwright.request.api": true,
			"server.address": "127.0.0.1",
			"url.path": "/native-request",
			"url.query": "source=post",
		}),
	);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);

	await expect(viewer.header.testName).toHaveText(
		"native Playwright request fixture trace",
	);
	await expect(viewer.steps.root).toBeVisible();
	await expect(viewer.steps.spanById(getSpan.spanId)).toBeVisible();
	await expect(viewer.steps.spanById(postSpan.spanId)).toBeVisible();
	await expect(viewer.browserSpans.spanById(getSpan.spanId)).toHaveCount(0);
	await expect(viewer.browserSpans.spanById(postSpan.spanId)).toHaveCount(0);
	await expect(viewer.externalSpans.spanById(getSpan.spanId)).toHaveCount(0);
	await expect(viewer.externalSpans.spanById(postSpan.spanId)).toHaveCount(0);
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
			attributes({ attributes: resourceSpan.resource.attributes })[
				"service.name"
			] ?? "unknown",
		);
		return resourceSpan.scopeSpans.flatMap((scopeSpan) =>
			scopeSpan.spans.map((span) => ({ ...span, serviceName })),
		);
	});
}

function requiredNativeRequestSpan(
	spans: SpanWithService[],
	method: string,
	query: string,
): SpanWithService {
	return requiredSpan(spans, `native ${method} request span`, (span) => {
		const attrs = attributes(span);
		return (
			span.name === `HTTP ${method}` &&
			span.serviceName === "playwright-tests" &&
			attrs["playwright.request.api"] === true &&
			attrs["url.path"] === "/native-request" &&
			attrs["url.query"] === query
		);
	});
}

function duplicateNativeRequestStepSpans(
	spans: SpanWithService[],
	method: string,
	query: string,
): SpanWithService[] {
	return spans.filter((span) => {
		const attrs = attributes(span);
		return (
			span.name === "playwright.test.step" &&
			span.serviceName === "playwright-tests" &&
			attrs["test.step.category"] === "pw:api" &&
			typeof attrs["test.step.title"] === "string" &&
			attrs["test.step.title"].startsWith(`${method} "`) &&
			attrs["test.step.title"].includes(`/native-request?${query}`)
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

function attributes(
	span: Pick<OtlpSpan, "attributes">,
): Record<string, string | number | boolean> {
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
