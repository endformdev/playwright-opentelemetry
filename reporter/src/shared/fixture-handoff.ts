import fs from "node:fs/promises";
import path from "node:path";
import type { TestInfo } from "@playwright/test";

/**
 * Unless `attachFixtureData` is on, the fixture hands its data to the reporter
 * as files rather than test attachments, which Playwright would copy into its
 * own trace and HTML report. Both sides find a test attempt's files from its
 * ID and retry: the ID is already unique per project, file, title and
 * repeat-each index.
 *
 * Not documented, but Endform relies on it: its worker controller seeds
 * {@link TRACE_CONTEXT_HANDOFF_FILE} here before dispatching an attempt, so
 * it knows the attempt's trace ID even though it runs the reporter in another
 * process. Keep the layout and format stable.
 */
export function fixtureHandoffDir(
	projectOutputDir: string,
	testId: string,
	retry: number,
): string {
	return path.join(fixtureHandoffRoot(projectOutputDir), `${testId}-${retry}`);
}

/**
 * In the project's output directory, which Playwright clears at the start of a
 * run, not the test's, which Playwright can remove before the reporter reads it.
 */
export function fixtureHandoffRoot(projectOutputDir: string): string {
	return path.join(projectOutputDir, ".playwright-opentelemetry");
}

export const TRACE_CONTEXT_HANDOFF_FILE = "trace-context.json";
export const FIXTURE_SPANS_HANDOFF_FILE = "fixture-spans.json";
export const SCREENSHOTS_HANDOFF_FILE = "screenshots.zip";
export const API_REQUESTS_HANDOFF_FILE = "api-requests.json";

/** Body of {@link TRACE_CONTEXT_HANDOFF_FILE}. */
export interface TraceContextHandoff {
	/** 32 hex characters. */
	traceId: string;
	/** The test span's span ID: 16 hex characters. */
	rootSpanId: string;
}

const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/i;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/i;

function isTraceContextHandoff(value: unknown): value is TraceContextHandoff {
	return (
		typeof value === "object" &&
		value !== null &&
		"traceId" in value &&
		"rootSpanId" in value &&
		typeof value.traceId === "string" &&
		typeof value.rootSpanId === "string" &&
		TRACE_ID_PATTERN.test(value.traceId) &&
		SPAN_ID_PATTERN.test(value.rootSpanId)
	);
}

export type FixtureHandoffTestInfo = Pick<
	TestInfo,
	"project" | "retry" | "testId"
>;

export async function writeFixtureHandoffFile(
	testInfo: FixtureHandoffTestInfo,
	fileName: string,
	data: string | Uint8Array,
): Promise<void> {
	const dir = testHandoffDir(testInfo);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(path.join(dir, fileName), data);
}

/**
 * The trace context a host seeded for this test attempt before its fixtures
 * ran, so the attempt uses the trace ID the host chose. `undefined` when there
 * is no seeded file; `"invalid"` when there is one the fixture can't use.
 */
export async function readSeededTraceContext(
	testInfo: FixtureHandoffTestInfo,
): Promise<TraceContextHandoff | "invalid" | undefined> {
	const filePath = path.join(
		testHandoffDir(testInfo),
		TRACE_CONTEXT_HANDOFF_FILE,
	);
	let body: string;
	try {
		body = await fs.readFile(filePath, "utf-8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		return "invalid";
	}

	try {
		const parsed: unknown = JSON.parse(body);
		return isTraceContextHandoff(parsed)
			? { traceId: parsed.traceId, rootSpanId: parsed.rootSpanId }
			: "invalid";
	} catch {
		return "invalid";
	}
}

function testHandoffDir(testInfo: FixtureHandoffTestInfo): string {
	return fixtureHandoffDir(
		testInfo.project.outputDir,
		testInfo.testId,
		testInfo.retry,
	);
}
