import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import {
	BROWSER_PAGE_SPANS_TRACE_ID_FILE,
	BROWSER_PAGE_SPANS_TRACE_ZIP_PATH_FILE,
} from "./setup/global-setup";

const TEST_NAME = "playwright.dev browser page navigation trace";
const TRACE_MARKER = "browser-page-span-e2e";

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
	startTimeUnixNano: string;
	endTimeUnixNano: string;
	attributes: OtlpAttribute[];
}

interface OtlpExport {
	resourceSpans: Array<{
		scopeSpans: Array<{
			spans: OtlpSpan[];
		}>;
	}>;
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

function attributes(span: OtlpSpan): Record<string, string | number | boolean> {
	return Object.fromEntries(
		span.attributes.flatMap((attribute) => {
			const value = attributeValue(attribute);
			return value === undefined ? [] : [[attribute.key, value]];
		}),
	);
}

function requiredSpan(
	spans: OtlpSpan[],
	description: string,
	predicate: (span: OtlpSpan) => boolean,
): OtlpSpan {
	const span = spans.find(predicate);
	if (!span) {
		throw new Error(`Missing ${description}`);
	}
	return span;
}

function pageSpan(spans: OtlpSpan[], path: string): OtlpSpan {
	return requiredSpan(
		spans,
		`document browser.page span for ${path}`,
		(span) => {
			const attrs = attributes(span);
			return (
				span.name === "browser.page" &&
				attrs["browser.resource.type"] === "page" &&
				attrs["browser.page.navigation.type"] === "document" &&
				attrs["url.path"] === path
			);
		},
	);
}

function routeSpan(spans: OtlpSpan[], path: string): OtlpSpan {
	return requiredSpan(
		spans,
		`same-document browser.route span for ${path}`,
		(span) => {
			const attrs = attributes(span);
			return (
				span.name === "browser.route" &&
				attrs["browser.resource.type"] === "route" &&
				attrs["browser.page.navigation.type"] === "same-document" &&
				attrs["url.path"] === path
			);
		},
	);
}

function markedDocumentRequest(spans: OtlpSpan[], label: string): OtlpSpan {
	const span = spans.find((span) => {
		const attrs = attributes(span);
		const url = String(attrs["url.full"] ?? "");
		return (
			span.name === "HTTP GET" &&
			attrs["http.resource.type"] === "document" &&
			url.includes(`${TRACE_MARKER}=${label}-`)
		);
	});
	if (!span) {
		const markerUrls = spans.flatMap((span) => {
			const attrs = attributes(span);
			const url = String(attrs["url.full"] ?? "");
			return url.includes(TRACE_MARKER) ? [`${span.name} ${url}`] : [];
		});
		throw new Error(
			`Missing marked document request ${label}. Found marker requests: ${markerUrls.join(", ")}`,
		);
	}
	return span;
}

function flattenSpans(exports: OtlpExport[]): OtlpSpan[] {
	return exports.flatMap((otlpExport) =>
		otlpExport.resourceSpans.flatMap((resourceSpan) =>
			resourceSpan.scopeSpans.flatMap((scopeSpan) => scopeSpan.spans),
		),
	);
}

async function loadTraceSpans(
	request: import("@playwright/test").APIRequestContext,
	traceId: string,
): Promise<OtlpSpan[]> {
	const response = await request.get(
		`${TRACE_API_URL}/playwright-otel-trace-viewer/v1/${traceId}/traces`,
	);
	expect(response.ok()).toBeTruthy();

	return flattenSpans([(await response.json()) as OtlpExport]);
}

test("renders browser page, route, and network spans from independent trace fragments", async ({
	page,
	request,
}) => {
	const traceId = readFileSync(
		BROWSER_PAGE_SPANS_TRACE_ID_FILE,
		"utf-8",
	).trim();
	const spans = await loadTraceSpans(request, traceId);

	const homePage = pageSpan(spans, "/");
	const docsRoute = routeSpan(spans, "/docs/intro");
	const pythonDocsPage = pageSpan(spans, "/python/docs/intro");

	expect(attributes(docsRoute)).toEqual(
		expect.objectContaining({
			"browser.document.url": "https://playwright.dev/",
			"browser.route.previous_url": "https://playwright.dev/",
		}),
	);
	expect(docsRoute.parentSpanId).toBe(homePage.spanId);
	expect(
		spans.filter(
			(span) =>
				(span.name === "browser.page" || span.name === "browser.route") &&
				String(attributes(span)["url.full"] ?? "").includes(
					"browser-page-span-e2e-anchor",
				),
		),
	).toEqual([]);

	const homeDocument = markedDocumentRequest(spans, "home");
	const docsDocument = markedDocumentRequest(spans, "docs-node");
	const pythonDocsDocument = markedDocumentRequest(spans, "docs-python");
	const afterHashDocument = markedDocumentRequest(
		spans,
		"after-hash-only-change",
	);

	expect(homeDocument.parentSpanId).toBe(homePage.spanId);
	expect(docsDocument.parentSpanId).toBe(docsRoute.spanId);
	expect(pythonDocsDocument.parentSpanId).toBe(pythonDocsPage.spanId);
	expect(afterHashDocument.parentSpanId).toBe(pythonDocsPage.spanId);
	expect(attributes(homeDocument)).toEqual(
		expect.objectContaining({
			"browser.request.route_association": "active-page",
		}),
	);
	expect(attributes(docsDocument)).toEqual(
		expect.objectContaining({
			"browser.request.route_association": "active-route",
		}),
	);
	expect(attributes(afterHashDocument)).toEqual(
		expect.objectContaining({
			"browser.request.route_association": "active-page",
		}),
	);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	await expect(viewer.header.testName).toHaveText(TEST_NAME);
	await expect(viewer.browserSpans.root).toBeVisible();
	await expect(viewer.browserSpans.spanById(homePage.spanId)).toBeVisible();
	await expect(viewer.browserSpans.spanById(docsRoute.spanId)).toBeVisible();
	await expect(
		viewer.browserSpans.spanById(pythonDocsPage.spanId),
	).toBeVisible();
	await expect(viewer.browserSpans.spanByName("/docs/intro")).toBeVisible();
	await expect(
		viewer.browserSpans.spanByName("/python/docs/intro"),
	).toBeVisible();
});

test("renders browser spans from reporter trace zip", async ({ page }) => {
	const traceZipPath = readFileSync(
		BROWSER_PAGE_SPANS_TRACE_ZIP_PATH_FILE,
		"utf-8",
	).trim();

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromZip(traceZipPath);

	await expect(viewer.header.testName).toHaveText(TEST_NAME);
	await expect(viewer.browserSpans.root).toBeVisible();
	await expect(viewer.browserSpans.spanByName("/docs/intro")).toBeVisible();
	await expect(
		viewer.browserSpans.spanByName("/python/docs/intro"),
	).toBeVisible();
});
