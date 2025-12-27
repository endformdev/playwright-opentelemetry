/**
 * OTEL trace parser - converts OTLP JSON to the domain model.
 */

import type {
	OtlpAttribute,
	OtlpSpan,
	OtlpTraceExport,
} from "../../types/otel";
import { OTEL_ATTR, OTEL_SPAN_NAME } from "../../types/otel";
import type {
	ParsedTrace,
	ResourceInfo,
	Screenshot,
	Span,
	SpanKind,
	TestInfo,
	TestOutcome,
	TimeRange,
} from "../../types/trace";

/**
 * Parse OTLP trace export into our domain model
 */
export function parseOtlpTrace(
	otlp: OtlpTraceExport,
	screenshots: Screenshot[],
): ParsedTrace {
	// Extract all spans from all resource spans
	const otlpSpans: OtlpSpan[] = [];
	let resourceInfo: ResourceInfo | undefined;

	for (const resourceSpan of otlp.resourceSpans) {
		if (!resourceInfo) {
			resourceInfo = extractResourceInfo(resourceSpan.resource.attributes);
		}
		for (const scopeSpan of resourceSpan.scopeSpans) {
			otlpSpans.push(...scopeSpan.spans);
		}
	}

	if (otlpSpans.length === 0) {
		throw new Error("No spans found in trace");
	}

	// Convert OTLP spans to domain spans
	const spanMap = new Map<string, Span>();
	const childrenMap = new Map<string, string[]>();

	for (const otlpSpan of otlpSpans) {
		const span = convertOtlpSpan(otlpSpan);
		spanMap.set(span.id, span);

		// Track parent-child relationships
		if (span.parentId) {
			const siblings = childrenMap.get(span.parentId) || [];
			siblings.push(span.id);
			childrenMap.set(span.parentId, siblings);
		}
	}

	// Build the tree structure and calculate depths
	let rootSpan: Span | undefined;
	for (const span of spanMap.values()) {
		if (!span.parentId) {
			rootSpan = span;
		}
		// Attach children
		const childIds = childrenMap.get(span.id) || [];
		span.children = childIds
			.map((id) => spanMap.get(id))
			.filter((s): s is Span => s !== undefined)
			.sort((a, b) => a.startTime - b.startTime);
	}

	if (!rootSpan) {
		// If no root span, find the test span or earliest span
		rootSpan = findRootSpan(spanMap);
	}

	// Calculate depths
	calculateDepths(rootSpan, 0);

	// Extract test info from root span
	const testInfo = extractTestInfo(rootSpan);

	// Calculate time range
	const timeRange = calculateTimeRange(spanMap);

	return {
		testInfo,
		rootSpan,
		spans: spanMap,
		screenshots,
		timeRange,
	};
}

/**
 * Convert nanoseconds string to milliseconds number
 */
export function nanosToMillis(nanos: string): number {
	return Number(BigInt(nanos) / BigInt(1_000_000));
}

/**
 * Convert OTLP span to domain span
 */
function convertOtlpSpan(otlpSpan: OtlpSpan): Span {
	const startTime = nanosToMillis(otlpSpan.startTimeUnixNano);
	const endTime = nanosToMillis(otlpSpan.endTimeUnixNano);
	const attributes = flattenAttributes(otlpSpan.attributes);

	return {
		id: otlpSpan.spanId,
		parentId: otlpSpan.parentSpanId || null,
		name: otlpSpan.name,
		kind: determineSpanKind(otlpSpan.name, attributes),
		startTime,
		endTime,
		duration: endTime - startTime,
		attributes,
		children: [],
		depth: 0,
	};
}

/**
 * Flatten OTLP attributes to a simple record
 */
export function flattenAttributes(
	attrs: OtlpAttribute[],
): Record<string, string | number | boolean> {
	const result: Record<string, string | number | boolean> = {};
	for (const attr of attrs) {
		const value = attr.value;
		if (value.stringValue !== undefined) {
			result[attr.key] = value.stringValue;
		} else if (value.intValue !== undefined) {
			result[attr.key] = value.intValue;
		} else if (value.doubleValue !== undefined) {
			result[attr.key] = value.doubleValue;
		} else if (value.boolValue !== undefined) {
			result[attr.key] = value.boolValue;
		}
	}
	return result;
}

/**
 * Determine the kind of span based on name and attributes
 */
function determineSpanKind(
	name: string,
	attributes: Record<string, string | number | boolean>,
): SpanKind {
	if (name === OTEL_SPAN_NAME.PLAYWRIGHT_TEST) {
		return "test";
	}
	if (name === OTEL_SPAN_NAME.PLAYWRIGHT_TEST_STEP) {
		const category = attributes[OTEL_ATTR.TEST_STEP_CATEGORY];
		if (category === "pw:api") {
			return "action";
		}
		return "step";
	}
	if (attributes[OTEL_ATTR.HTTP_METHOD]) {
		return "network";
	}
	return "other";
}

/**
 * Find the root span (span without parent or the test span)
 */
function findRootSpan(spans: Map<string, Span>): Span {
	// First, try to find a span without a parent
	for (const span of spans.values()) {
		if (!span.parentId) {
			return span;
		}
	}

	// Otherwise, find the test span
	for (const span of spans.values()) {
		if (span.kind === "test") {
			return span;
		}
	}

	// Fallback to the first span
	const firstSpan = spans.values().next().value;
	if (!firstSpan) {
		throw new Error("No spans in trace");
	}
	return firstSpan;
}

/**
 * Calculate depths for all spans in the tree
 */
function calculateDepths(span: Span, depth: number): void {
	span.depth = depth;
	for (const child of span.children) {
		calculateDepths(child, depth + 1);
	}
}

/**
 * Extract test info from the root/test span
 */
function extractTestInfo(rootSpan: Span): TestInfo {
	const attrs = rootSpan.attributes;

	const name =
		(attrs[OTEL_ATTR.TEST_CASE_NAME] as string) || rootSpan.name || "Unknown";
	const title =
		(attrs[OTEL_ATTR.TEST_CASE_TITLE] as string) ||
		(attrs[OTEL_ATTR.TEST_STEP_TITLE] as string) ||
		name;
	const file = (attrs[OTEL_ATTR.CODE_FILE_PATH] as string) || "";
	const line = (attrs[OTEL_ATTR.CODE_LINE_NUMBER] as number) || 0;
	const status =
		(attrs[OTEL_ATTR.TEST_CASE_RESULT_STATUS] as string) || "passed";

	return {
		name,
		title,
		file,
		line,
		duration: rootSpan.duration,
		outcome: normalizeOutcome(status),
		startTime: rootSpan.startTime,
	};
}

/**
 * Normalize test outcome string
 */
function normalizeOutcome(status: string): TestOutcome {
	const normalized = status.toLowerCase();
	if (
		normalized === "passed" ||
		normalized === "failed" ||
		normalized === "skipped" ||
		normalized === "timedout" ||
		normalized === "interrupted"
	) {
		return normalized as TestOutcome;
	}
	return "passed";
}

/**
 * Calculate time range from all spans
 */
function calculateTimeRange(spans: Map<string, Span>): TimeRange {
	let start = Number.POSITIVE_INFINITY;
	let end = Number.NEGATIVE_INFINITY;

	for (const span of spans.values()) {
		if (span.startTime < start) {
			start = span.startTime;
		}
		if (span.endTime > end) {
			end = span.endTime;
		}
	}

	return {
		start,
		end,
		duration: end - start,
	};
}

/**
 * Extract resource info from OTLP resource attributes
 */
function extractResourceInfo(attrs: OtlpAttribute[]): ResourceInfo {
	const flat = flattenAttributes(attrs);
	return {
		serviceName: (flat[OTEL_ATTR.SERVICE_NAME] as string) || "unknown",
		serviceNamespace:
			(flat[OTEL_ATTR.SERVICE_NAMESPACE] as string) || "unknown",
		serviceVersion: (flat[OTEL_ATTR.SERVICE_VERSION] as string) || "unknown",
	};
}

/**
 * Create screenshots from a list of filenames and a base URL
 */
export function createScreenshots(
	filenames: string[],
	baseUrl: string,
): Screenshot[] {
	return filenames.map((filename, index) => {
		// Try to extract timestamp from filename (format: timestamp_pageId.jpeg)
		const timestampMatch = filename.match(/^(\d+)_/);
		const timestamp = timestampMatch ? parseInt(timestampMatch[1], 10) : 0;

		return {
			id: `screenshot-${index}`,
			filename,
			timestamp,
			url: `${baseUrl}/${filename}`,
		};
	});
}
