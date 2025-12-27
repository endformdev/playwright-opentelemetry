/**
 * Domain types for the trace viewer.
 * These are the normalized, UI-friendly types derived from parsing OTLP data.
 */

/**
 * Represents a single span in the trace tree
 */
export interface Span {
	id: string;
	parentId: string | null;
	name: string;
	kind: SpanKind;
	startTime: number; // Unix timestamp in milliseconds
	endTime: number; // Unix timestamp in milliseconds
	duration: number; // in milliseconds
	attributes: Record<string, string | number | boolean>;
	children: Span[];
	depth: number;
}

export type SpanKind =
	| "test"
	| "step"
	| "action"
	| "network"
	| "console"
	| "other";

/**
 * Test result status from Playwright
 */
export type TestOutcome =
	| "passed"
	| "failed"
	| "skipped"
	| "timedOut"
	| "interrupted";

/**
 * Information about the test extracted from the root test span
 */
export interface TestInfo {
	name: string;
	title: string;
	file: string;
	line: number;
	duration: number; // in milliseconds
	outcome: TestOutcome;
	startTime: number; // Unix timestamp in milliseconds
}

/**
 * Reference to a screenshot in the trace
 */
export interface Screenshot {
	id: string;
	filename: string;
	timestamp: number; // Unix timestamp in milliseconds
	url: string; // URL to fetch the screenshot (served by SW or remote)
}

/**
 * Time range of the trace
 */
export interface TimeRange {
	start: number; // Unix timestamp in milliseconds
	end: number; // Unix timestamp in milliseconds
	duration: number; // in milliseconds
}

/**
 * Fully parsed trace data ready for rendering
 */
export interface ParsedTrace {
	testInfo: TestInfo;
	rootSpan: Span;
	spans: Map<string, Span>;
	screenshots: Screenshot[];
	timeRange: TimeRange;
}

/**
 * Resource information from OTLP
 */
export interface ResourceInfo {
	serviceName: string;
	serviceNamespace: string;
	serviceVersion: string;
}
