import type { OtlpAttribute, OtlpExport, OtlpSpan } from "../trace-data-loader";
import type { TestInfo, TestStatus } from "./TraceInfoLoader";

const TEST_SPAN_NAME = "playwright.test";

export function deriveTestInfoFromOtlpExports(exports: OtlpExport[]): TestInfo {
	const testSpans = exports.flatMap((otlpExport) => findTestSpans(otlpExport));
	const testSpan = chooseRootTestSpan(testSpans);

	if (!testSpan) {
		throw new Error(
			`Unable to derive test info: no ${TEST_SPAN_NAME} span found in OTLP trace data`,
		);
	}

	const attributes = flattenAttributes(testSpan.attributes ?? []);
	const title = stringAttribute(attributes, "test.case.title") ?? testSpan.name;

	return {
		name: title,
		describes: stringArrayAttribute(attributes, "playwright.test.describes"),
		file: stringAttribute(attributes, "code.file.path") ?? "",
		line: numberAttribute(attributes, "code.line.number") ?? 0,
		status: toTestStatus(stringAttribute(attributes, "playwright.test.status")),
		traceId: testSpan.traceId,
		startTimeUnixNano: testSpan.startTimeUnixNano,
		endTimeUnixNano: testSpan.endTimeUnixNano,
	};
}

function findTestSpans(otlpExport: OtlpExport): OtlpSpan[] {
	return otlpExport.resourceSpans.flatMap((resourceSpans) =>
		resourceSpans.scopeSpans.flatMap((scopeSpans) =>
			scopeSpans.spans.filter((span) => span.name === TEST_SPAN_NAME),
		),
	);
}

function chooseRootTestSpan(spans: OtlpSpan[]): OtlpSpan | undefined {
	const rootSpans = spans.filter((span) => !span.parentSpanId);
	const candidates = rootSpans.length > 0 ? rootSpans : spans;
	return candidates.sort((a, b) =>
		a.startTimeUnixNano.localeCompare(b.startTimeUnixNano),
	)[0];
}

type AttributeValue = string | number | boolean | string[];

function flattenAttributes(
	attributes: OtlpAttribute[],
): Record<string, AttributeValue> {
	const result: Record<string, AttributeValue> = {};

	for (const attribute of attributes) {
		const value = extractAttributeValue(attribute);
		if (value !== undefined) {
			result[attribute.key] = value;
		}
	}

	return result;
}

function extractAttributeValue(
	attribute: OtlpAttribute,
): AttributeValue | undefined {
	const { value } = attribute;
	if (value.stringValue !== undefined) return value.stringValue;
	if (value.intValue !== undefined) return value.intValue;
	if (value.doubleValue !== undefined) return value.doubleValue;
	if (value.boolValue !== undefined) return value.boolValue;
	if (value.arrayValue !== undefined) {
		return value.arrayValue.values.flatMap((item) =>
			item.stringValue === undefined ? [] : [item.stringValue],
		);
	}
	return undefined;
}

function stringAttribute(
	attributes: Record<string, AttributeValue>,
	key: string,
): string | undefined {
	const value = attributes[key];
	return typeof value === "string" ? value : undefined;
}

function numberAttribute(
	attributes: Record<string, AttributeValue>,
	key: string,
): number | undefined {
	const value = attributes[key];
	return typeof value === "number" ? value : undefined;
}

function stringArrayAttribute(
	attributes: Record<string, AttributeValue>,
	key: string,
): string[] {
	const value = attributes[key];
	return Array.isArray(value) ? value : [];
}

function toTestStatus(status: string | undefined): TestStatus {
	switch (status) {
		case "failed":
		case "skipped":
		case "timedOut":
		case "interrupted":
			return status;
		default:
			return "passed";
	}
}
