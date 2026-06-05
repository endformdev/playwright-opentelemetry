import type { FullConfig } from "@playwright/test";

const PLAYWRIGHT_OPENTELEMETRY_REPORTER_NAMES = new Set([
	"playwright-opentelemetry",
	"playwright-opentelemetry/reporter",
]);

const PLAYWRIGHT_OPENTELEMETRY_REPORTER_PATHS = [
	"dist/reporter.mjs",
	"dist/reporter.cjs",
] as const;

export const MISSING_PLAYWRIGHT_OPENTELEMETRY_REPORTER_ERROR = `playwright-opentelemetry fixture is enabled, but the reporter is missing.

Add it to playwright.config.ts:

reporter: [["playwright-opentelemetry/reporter"]]`;

export function hasPlaywrightOpentelemetryReporter(
	reporter: FullConfig["reporter"],
): boolean {
	return reporter.some(([reporterName]) =>
		isPlaywrightOpentelemetryReporterName(reporterName),
	);
}

function isPlaywrightOpentelemetryReporterName(reporterName: string): boolean {
	if (PLAYWRIGHT_OPENTELEMETRY_REPORTER_NAMES.has(reporterName)) {
		return true;
	}

	const normalizedReporterName = reporterName.replace(/\\/g, "/");
	return PLAYWRIGHT_OPENTELEMETRY_REPORTER_PATHS.some(
		(reporterPath) =>
			normalizedReporterName === reporterPath ||
			normalizedReporterName.endsWith(`/${reporterPath}`),
	);
}
