import { beforeEach, describe, expect, it, vi } from "vitest";
import { runReporterTest } from "./reporter-harness";

vi.mock("../src/reporter/sender", () => ({
	sendSpans: vi.fn(),
}));

import { sendSpans } from "../src/reporter/sender";

describe("PlaywrightOpentelemetryReporter trace retention", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("publishes when Playwright retained a trace attachment", async () => {
		const { testResult } = await runReporterTest({
			test: { title: "retained trace" },
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);
		expect(testResult.attachments).toContainEqual(
			expect.objectContaining({
				name: "playwright-opentelemetry-trace-id",
				contentType: "text/plain",
			}),
		);
	});

	it("does not publish when Playwright did not retain a trace attachment", async () => {
		const { testResult } = await runReporterTest({
			test: { title: "no retained trace" },
			result: { attachments: [] },
		});

		expect(sendSpans).not.toHaveBeenCalled();
		expect(testResult.attachments).toEqual([]);
	});
});
