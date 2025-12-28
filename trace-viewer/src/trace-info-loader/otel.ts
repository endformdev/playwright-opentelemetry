/**
 * OpenTelemetry Protocol (OTLP) types as produced by the Playwright reporter.
 * These match the JSON format from buildOtlpRequest in the reporter.
 */

export interface OtlpAttributeValue {
	stringValue?: string;
	intValue?: number;
	doubleValue?: number;
	boolValue?: boolean;
}

export interface OtlpAttribute {
	key: string;
	value: OtlpAttributeValue;
}

export interface OtlpSpanStatus {
	code: number;
	message?: string;
}

export interface OtlpSpan {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	kind: number;
	startTimeUnixNano: string;
	endTimeUnixNano: string;
	attributes: OtlpAttribute[];
	droppedAttributesCount: number;
	events: unknown[];
	droppedEventsCount: number;
	status: OtlpSpanStatus;
	links: unknown[];
	droppedLinksCount: number;
}

export interface OtlpScope {
	name: string;
	version: string;
}

export interface OtlpScopeSpans {
	scope: OtlpScope;
	spans: OtlpSpan[];
}

export interface OtlpResource {
	attributes: OtlpAttribute[];
}

export interface OtlpResourceSpans {
	resource: OtlpResource;
	scopeSpans: OtlpScopeSpans[];
}

export interface OtlpTraceExport {
	resourceSpans: OtlpResourceSpans[];
}

/**
 * Well-known attribute keys from the reporter
 */
export const OTEL_ATTR = {
	// Standard OTEL attributes
	CODE_FILE_PATH: "code.file.path",
	CODE_LINE_NUMBER: "code.line.number",
	SERVICE_NAME: "service.name",
	SERVICE_NAMESPACE: "service.namespace",
	SERVICE_VERSION: "service.version",

	// Test attributes (OTEL semantic conventions)
	TEST_CASE_NAME: "test.case.name",
	TEST_CASE_TITLE: "test.case.title",
	TEST_CASE_RESULT_STATUS: "test.case.result.status",

	// Playwright-specific attributes
	TEST_STEP_NAME: "test.step.name",
	TEST_STEP_TITLE: "test.step.title",
	TEST_STEP_CATEGORY: "test.step.category",

	// HTTP attributes for network spans
	HTTP_METHOD: "http.method",
	HTTP_URL: "http.url",
	HTTP_STATUS_CODE: "http.status_code",
	HTTP_REQUEST_BODY_SIZE: "http.request.body.size",
	HTTP_RESPONSE_BODY_SIZE: "http.response.body.size",
} as const;

/**
 * Well-known span names from the reporter
 */
export const OTEL_SPAN_NAME = {
	PLAYWRIGHT_TEST: "playwright.test",
	PLAYWRIGHT_TEST_STEP: "playwright.test.step",
} as const;
