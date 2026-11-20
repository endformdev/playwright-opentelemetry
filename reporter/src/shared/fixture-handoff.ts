import fs from "node:fs/promises";
import path from "node:path";
import type { TestInfo } from "@playwright/test";

/**
 * Unless `attachFixtureData` is on, the fixture hands its data to the reporter
 * as files rather than test attachments, which Playwright would copy into its
 * own trace and HTML report. Both sides find a test attempt's files from its
 * ID and retry: the ID is already unique per project, file, title and
 * repeat-each index.
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

export type FixtureHandoffTestInfo = Pick<
	TestInfo,
	"project" | "retry" | "testId"
>;

export async function writeFixtureHandoffFile(
	testInfo: FixtureHandoffTestInfo,
	fileName: string,
	data: string | Uint8Array,
): Promise<void> {
	const dir = fixtureHandoffDir(
		testInfo.project.outputDir,
		testInfo.testId,
		testInfo.retry,
	);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(path.join(dir, fileName), data);
}
