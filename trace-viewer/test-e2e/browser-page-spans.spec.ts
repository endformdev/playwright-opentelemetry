import { expect, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";

const TEST_NAME = "playwright.dev browser page navigation trace";

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

function attributeValue(attribute: OtlpAttribute): string | number | boolean | undefined {
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

function flattenSpans(exports: OtlpExport[]): OtlpSpan[] {
	return exports.flatMap((otlpExport) =>
		otlpExport.resourceSpans.flatMap((resourceSpan) =>
			resourceSpan.scopeSpans.flatMap((scopeSpan) => scopeSpan.spans),
		),
	);
}

async function findTraceIdForTest(
	request: import("@playwright/test").APIRequestContext,
): Promise<string> {
	const traceIdsResponse = await request.get(`${TRACE_API_URL}/trace-ids`);
	expect(traceIdsResponse.ok()).toBeTruthy();

	const { traceIds } = (await traceIdsResponse.json()) as { traceIds: string[] };
	const matches: Array<{ traceId: string; startTimeUnixNano: bigint }> = [];

	for (const traceId of traceIds) {
		const testInfoResponse = await request.get(
			`${TRACE_API_URL}/otel-trace-viewer/${traceId}/test.json`,
		);
		if (!testInfoResponse.ok()) continue;

		const testInfo = (await testInfoResponse.json()) as {
			name?: string;
			status?: string;
			startTimeUnixNano?: string;
		};
		if (testInfo.name === TEST_NAME && testInfo.status === "passed") {
			matches.push({
				traceId,
				startTimeUnixNano: BigInt(testInfo.startTimeUnixNano ?? "0"),
			});
		}
	}

	matches.sort((a, b) =>
		a.startTimeUnixNano > b.startTimeUnixNano
			? -1
			: a.startTimeUnixNano < b.startTimeUnixNano
				? 1
				: 0,
	);

	if (matches[0]) {
		return matches[0].traceId;
	}

	throw new Error(`Could not find trace for ${TEST_NAME}`);
}

async function loadTraceSpans(
	request: import("@playwright/test").APIRequestContext,
	traceId: string,
): Promise<OtlpSpan[]> {
	const listResponse = await request.get(
		`${TRACE_API_URL}/otel-trace-viewer/${traceId}/opentelemetry-protocol`,
	);
	expect(listResponse.ok()).toBeTruthy();

	const { jsonFiles } = (await listResponse.json()) as { jsonFiles: string[] };
	const exports = await Promise.all(
		jsonFiles.map(async (jsonFile) => {
			const response = await request.get(
				`${TRACE_API_URL}/otel-trace-viewer/${traceId}/opentelemetry-protocol/${jsonFile}`,
			);
			expect(response.ok()).toBeTruthy();
			return (await response.json()) as OtlpExport;
		}),
	);

	return flattenSpans(exports);
}

test("renders browser.page spans with nested network requests from reporter output", async ({
	page,
	request,
}) => {
	const traceId = await findTraceIdForTest(request);
	const spans = await loadTraceSpans(request, traceId);
	const browserPageSpans = spans.filter((span) => span.name === "browser.page");

	expect(browserPageSpans.length).toBeGreaterThanOrEqual(3);
	expect(
		browserPageSpans.some(
			(span) => attributes(span)["browser.page.navigation.type"] === "document",
		),
	).toBeTruthy();
	expect(
		browserPageSpans.some(
			(span) =>
				attributes(span)["browser.page.navigation.type"] === "same-document",
		),
	).toBeTruthy();
	expect(
		browserPageSpans.some((span) =>
			String(attributes(span)["url.full"] ?? "").includes(
				"browser-page-span-e2e-anchor",
			),
		),
	).toBeFalsy();

	const browserPageSpanIds = new Set(browserPageSpans.map((span) => span.spanId));
	const nestedNetworkSpans = spans.filter(
		(span) =>
			span.name.startsWith("HTTP ") &&
			browserPageSpanIds.has(span.parentSpanId ?? ""),
	);

	expect(nestedNetworkSpans.length).toBeGreaterThanOrEqual(2);

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	await expect(viewer.header.testName).toHaveText(TEST_NAME);
	await expect(viewer.browserSpans.root).toBeVisible();

	for (const browserPageSpan of browserPageSpans) {
		await expect(viewer.browserSpans.spanById(browserPageSpan.spanId)).toBeVisible();
	}

	for (const childSpan of nestedNetworkSpans.slice(0, 5)) {
		const parentSpan = browserPageSpans.find(
			(span) => span.spanId === childSpan.parentSpanId,
		);
		expect(parentSpan).toBeDefined();

		await expect(viewer.browserSpans.spanById(childSpan.spanId)).toBeVisible();

		const parentData = await viewer.browserSpans.spanDataById(parentSpan!.spanId);
		const childData = await viewer.browserSpans.spanDataById(childSpan.spanId);
		expect(childData.row).toBeGreaterThan(parentData.row);
		expect(childData.startMs).toBeGreaterThanOrEqual(parentData.startMs);
		expect(childData.endMs).toBeLessThanOrEqual(parentData.endMs);
	}
});
