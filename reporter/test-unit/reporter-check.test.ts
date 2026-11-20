import { test as base, type WorkerInfo } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { createPlaywrightOtelTest } from "../src/fixture/playwright-opentelemetry-fixture";
import { MISSING_PLAYWRIGHT_OPENTELEMETRY_REPORTER_ERROR } from "../src/fixture/reporter-config";
import type { PlaywrightOpentelemetryConfig } from "../src/shared/config";

type ReporterCheckFixture = (
	fixtures: object,
	use: () => Promise<void>,
	workerInfo: WorkerInfo,
) => Promise<void>;

describe("missing reporter check", () => {
	it("fails the worker when the reporter isn't in this run", async () => {
		const use = vi.fn(async () => {});

		await expect(runCheck({}, use)).rejects.toThrow(
			MISSING_PLAYWRIGHT_OPENTELEMETRY_REPORTER_ERROR,
		);
		expect(use).not.toHaveBeenCalled();
	});

	it("allows a run without the reporter when fixture data is attached for merge-reports", async () => {
		const use = vi.fn(async () => {});

		await runCheck({ attachFixtureData: true }, use);

		expect(use).toHaveBeenCalledOnce();
	});
});

function runCheck(
	playwrightOpentelemetry: PlaywrightOpentelemetryConfig,
	use: () => Promise<void>,
) {
	return reporterCheckFixture()({}, use, {
		config: { reporter: [["blob"]] },
		project: { use: { playwrightOpentelemetry } },
	} as unknown as WorkerInfo);
}

function reporterCheckFixture(): ReporterCheckFixture {
	const extend = vi.spyOn(base, "extend").mockReturnValue(base);
	try {
		createPlaywrightOtelTest(base);
		const fixtures = extend.mock.calls[0][0] as Record<string, unknown>;
		const [fixture] = fixtures._playwrightOpentelemetryReporterCheck as [
			ReporterCheckFixture,
		];
		return fixture;
	} finally {
		extend.mockRestore();
	}
}
