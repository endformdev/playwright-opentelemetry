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

	it("does not publish spans when Playwright did not retain a trace attachment", async () => {
		const { testResult } = await runReporterTest({
			test: { title: "no retained trace" },
			result: { attachments: [] },
		});

		expect(sendSpans).not.toHaveBeenCalled();
		expect(testResult.attachments).not.toContainEqual(
			expect.objectContaining({
				name: "playwright-opentelemetry-trace-id",
				contentType: "text/plain",
			}),
		);
	});

	it("publishes without a Playwright trace attachment when the trace override retains the test", async () => {
		const { testResult } = await runReporterTest({
			playwrightOpentelemetry: { trace: "on" },
			test: { title: "otel trace override on" },
			result: { attachments: [] },
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);
		expect(testResult.attachments).toContainEqual(
			expect.objectContaining({
				name: "playwright-opentelemetry-trace-id",
				contentType: "text/plain",
			}),
		);
	});

	it("does not publish with a Playwright trace attachment when the trace override discards the test", async () => {
		const { testResult } = await runReporterTest({
			playwrightOpentelemetry: { trace: "off" },
			test: { title: "otel trace override off" },
		});

		expect(sendSpans).not.toHaveBeenCalled();
		expect(testResult.attachments).not.toContainEqual(
			expect.objectContaining({
				name: "playwright-opentelemetry-trace-id",
				contentType: "text/plain",
			}),
		);
	});

	it("supports retry-based trace overrides without relying on Playwright attachments", async () => {
		await runReporterTest({
			playwrightOpentelemetry: { trace: "on-first-retry" },
			test: { title: "otel trace override retry" },
			result: { attachments: [], retry: 1 },
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);
	});
});
