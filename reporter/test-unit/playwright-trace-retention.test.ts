import { describe, it } from "vitest";

describe("PlaywrightOpentelemetryReporter - Playwright trace retention publishing", () => {
	it.todo("does not attach playwright-opentelemetry-trace-id in onTestBegin");
	it.todo(
		"keeps an internal trace ID in onTestBegin for fixture and span coordination",
	);
	it.todo("publishes spans when Playwright retains a trace zip attachment");
	it.todo(
		"attaches playwright-opentelemetry-trace-id in onTestEnd only when publishing",
	);
	it.todo("does not publish spans when result has no trace attachment");
	it.todo("does not attach trace ID when result has no trace attachment");
	it.todo("does not publish spans when the trace attachment has no path");
	it.todo("does not publish spans for non-zip trace attachments");
	it.todo("does not publish spans for zip attachments with a non-trace name");
	it.todo("sends only retained-trace test spans to the OTLP endpoint in onEnd");
	it.todo("sends only retained-trace test spans to the trace API OTLP endpoint");
	it.todo("uploads test.json only when Playwright retained a trace zip");
	it.todo("uploads extracted screenshots only when Playwright retained a trace zip");
	it.todo("does not upload test.json or screenshots when no trace zip was retained");
	it.todo("creates local storeTraceZip output only when Playwright retained a trace zip");
	it.todo("does not create local storeTraceZip output when no trace zip was retained");
	it.todo("extracts screenshots from the retained Playwright trace zip before publishing");
	it.todo("cleans temporary trace coordination files for both published and skipped tests");
});

describe("PlaywrightOpentelemetryReporter - Playwright trace mode matrix", () => {
	it.todo("matches trace off by publishing no OTel trace");
	it.todo("matches trace on by publishing passed test OTel traces");
	it.todo("matches trace on by publishing failed test OTel traces");
	it.todo("matches retain-on-failure by publishing failed test OTel traces");
	it.todo("matches retain-on-failure by skipping passed test OTel traces");
	it.todo("matches on-first-retry by publishing the first retry trace only");
	it.todo("matches on-all-retries by publishing retry traces only");
	it.todo("matches retain-on-first-failure by publishing first failed attempt traces");
	it.todo(
		"matches retain-on-failure-and-retries by publishing failed attempt and retry traces",
	);
	it.todo("matches object trace mode by using Playwright's retained attachment");
});
