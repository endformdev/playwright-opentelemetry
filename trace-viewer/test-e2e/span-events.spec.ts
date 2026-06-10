import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	TRACE_API_URL,
	TraceViewerPage,
} from "./page-objects/trace-viewer-page";
import { SPAN_EVENTS_TRACE_ID_FILE } from "./setup/global-setup";

interface OtlpAttribute {
	key: string;
	value: {
		stringValue?: string;
		intValue?: number;
		doubleValue?: number;
		boolValue?: boolean;
	};
}

interface OtlpEvent {
	name: string;
	timeUnixNano: string;
	attributes: OtlpAttribute[];
}

interface OtlpSpan {
	spanId: string;
	name: string;
	events: OtlpEvent[];
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

function eventAttributes(
	event: OtlpEvent,
): Record<string, string | number | boolean> {
	return Object.fromEntries(
		event.attributes.flatMap((attribute) => {
			const value = attributeValue(attribute);
			return value === undefined ? [] : [[attribute.key, value]];
		}),
	);
}

function flattenSpans(otlpExport: OtlpExport): OtlpSpan[] {
	return otlpExport.resourceSpans.flatMap((resourceSpan) =>
		resourceSpan.scopeSpans.flatMap((scopeSpan) => scopeSpan.spans),
	);
}

test("shows browser console and exception events on spans", async ({
	page,
	request,
}) => {
	const traceId = readFileSync(SPAN_EVENTS_TRACE_ID_FILE, "utf-8").trim();
	const response = await request.get(
		`${TRACE_API_URL}/playwright-otel-trace-viewer/v1/${traceId}/traces`,
	);
	expect(response.ok()).toBeTruthy();
	const spans = flattenSpans((await response.json()) as OtlpExport);
	const browserSpan = spans.find((span) =>
		span.events.some(
			(event) =>
				event.name === "log" &&
				eventAttributes(event).message === "Browser span error event",
		),
	);
	expect(browserSpan).toBeTruthy();
	expect(browserSpan?.events.map((event) => event.name)).toContain("exception");

	const viewer = new TraceViewerPage(page);
	await viewer.loadTraceFromApi(traceId);
	await expect(viewer.header.testName).toHaveText(
		"browser console and page error span events",
	);

	const spanBar = viewer.browserSpans.spanById(browserSpan!.spanId).first();
	await expect(spanBar).toBeVisible();
	const eventMarkers = spanBar.getByTestId("span-event-marker");
	await expect(eventMarkers).toHaveCount(4);
	await expect(eventMarkers.first()).toBeVisible();
	await expect(eventMarkers.first()).toHaveAttribute("title", /Browser span/);
	await expect(
		spanBar.locator(
			'[data-testid="span-event-marker"][data-span-event-error="true"]',
		),
	).toHaveCount(2);

	const markerLeftPositions = await eventMarkers.evaluateAll((markers) =>
		markers.map((marker) => marker.getBoundingClientRect().left),
	);
	expect(new Set(markerLeftPositions.map(Math.round)).size).toBeGreaterThan(2);

	await spanBar.hover();
	const spanDetails = viewer.details.spanDetailsById(browserSpan!.spanId);
	await expect(spanDetails).toBeVisible();
	await expect(
		spanDetails.getByTestId("span-event-card").first(),
	).toBeVisible();
	await expect(spanDetails).toContainText("Browser span error event");
	await expect(spanDetails).toContainText("exception");
	await expect(spanDetails).toContainText("Browser span thrown error");
	await expect(
		spanDetails.locator(
			'[data-testid="span-event-card"][data-span-event-error="true"]',
		),
	).toHaveCount(2);
});
