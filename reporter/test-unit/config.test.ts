import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	resolvePlaywrightOpentelemetryConfig,
	type PlaywrightOpentelemetryConfig,
} from "../src/shared/config";

const ENV_KEYS = [
	"OTEL_EXPORTER_OTLP_ENDPOINT",
	"OTEL_EXPORTER_OTLP_HEADERS",
	"OTEL_SERVICE_NAME",
	"PLAYWRIGHT_TRACE_API_ENDPOINT",
	"PLAYWRIGHT_TRACE_API_HEADERS",
	"PLAYWRIGHT_OPENTELEMETRY_DEBUG",
] as const;

const DESTINATION_CONFIGS = [
	["OTLP endpoint", { otlpEndpoint: "http://localhost:4317/v1/traces" }],
	[
		"trace API endpoint",
		{ playwrightTraceApiEndpoint: "https://traces.example.com" },
	],
	["trace ZIP storage", { storeTraceZip: true }],
] satisfies Array<[string, PlaywrightOpentelemetryConfig]>;

describe("resolvePlaywrightOpentelemetryConfig", () => {
	let originalEnv: Record<(typeof ENV_KEYS)[number], string | undefined>;

	beforeEach(() => {
		originalEnv = Object.fromEntries(
			ENV_KEYS.map((key) => [key, process.env[key]]),
		) as Record<(typeof ENV_KEYS)[number], string | undefined>;
		for (const key of ENV_KEYS) {
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			const originalValue = originalEnv[key];
			if (originalValue === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = originalValue;
			}
		}
	});

	it("allows missing destinations by default", () => {
		expect(resolvePlaywrightOpentelemetryConfig(undefined)).toMatchObject({
			otlpEndpoint: "",
			playwrightTraceApiEndpoint: "",
			storeTraceZip: false,
			propagateTraceHeaders: true,
		});
	});

	it("allows trace header propagation to be disabled", () => {
		expect(
			resolvePlaywrightOpentelemetryConfig({
				propagateTraceHeaders: false,
			}),
		).toMatchObject({
			propagateTraceHeaders: false,
		});
	});

	it("throws a configuration error when a destination is required", () => {
		expect(() =>
			resolvePlaywrightOpentelemetryConfig(undefined, {
				requireDestination: true,
			}),
		).toThrowError(
			/playwright-opentelemetry reporter requires an OTLP endpoint, trace API endpoint, or storeTraceZip/,
		);
	});

	it.each(
		DESTINATION_CONFIGS,
	)("accepts %s when a destination is required", (_name, config) => {
		expect(() =>
			resolvePlaywrightOpentelemetryConfig(config, {
				requireDestination: true,
			}),
		).not.toThrow();
	});

	it("accepts environment destinations when a destination is required", () => {
		process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4317/v1/traces";

		expect(() =>
			resolvePlaywrightOpentelemetryConfig(undefined, {
				requireDestination: true,
			}),
		).not.toThrow();
	});
});
