import type { FullConfig } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { hasPlaywrightOpentelemetryReporter } from "../src/fixture/reporter-config";

describe("hasPlaywrightOpentelemetryReporter", () => {
	it.each([
		"playwright-opentelemetry",
		"playwright-opentelemetry/reporter",
		"dist/reporter.mjs",
		"./dist/reporter.mjs",
		"../dist/reporter.mjs",
		"/Users/test/project/dist/reporter.mjs",
		"..\\dist\\reporter.mjs",
		"./dist/reporter.cjs",
	])("accepts %s", (reporterName) => {
		expect(
			hasPlaywrightOpentelemetryReporter(reporterConfig([reporterName])),
		).toBe(true);
	});

	it.each([
		[[]],
		[["list"]],
		[["list", "html"]],
		[["playwright-opentelemetry-fixture"]],
		[["./dist/other-reporter.mjs"]],
	])("rejects %s", (reporterNames) => {
		expect(
			hasPlaywrightOpentelemetryReporter(reporterConfig(reporterNames)),
		).toBe(false);
	});
});

function reporterConfig(reporterNames: string[]): FullConfig["reporter"] {
	return reporterNames.map((reporterName) => [reporterName] as [string]);
}
