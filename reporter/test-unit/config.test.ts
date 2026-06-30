import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	resolvePlaywrightOpentelemetryConfig,
	type PlaywrightOpentelemetryConfig,
} from "../src/shared/config";

const ENV_KEYS = [
	"OTEL_EXPORTER_OTLP_ENDPOINT",
	"OTEL_EXPORTER_OTLP_HEADERS",
	"PLAYWRIGHT_TRACE_API_ENDPOINT",
	"PLAYWRIGHT_TRACE_API_HEADERS",
	"PLAYWRIGHT_OPENTELEMETRY_DEBUG",
] as const;

const DESTINATION_CONFIGS = [
	[
		"OTLP endpoint",
		{ otlpEndpoint: { url: "http://localhost:4317/v1/traces" } },
	],
	[
		"trace API endpoint",
		{ playwrightTraceApiEndpoint: { url: "https://traces.example.com" } },
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
			otlpDestinations: [],
			playwrightTraceApiDestinations: [],
			storeTraceZip: false,
			trace: null,
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

	it("preserves a Playwright-style trace override", () => {
		expect(
			resolvePlaywrightOpentelemetryConfig({
				trace: {
					mode: "retain-on-failure",
					screenshots: true,
					snapshots: false,
					sources: false,
					attachments: false,
				},
			}),
		).toMatchObject({
			trace: {
				mode: "retain-on-failure",
				screenshots: true,
				snapshots: false,
				sources: false,
				attachments: false,
			},
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

	it("resolves a singular OTLP destination with headers", () => {
		expect(
			resolvePlaywrightOpentelemetryConfig({
				otlpEndpoint: {
					url: "http://localhost:4317/v1/traces",
					headers: { Authorization: "Bearer config-token" },
				},
			}),
		).toMatchObject({
			otlpDestinations: [
				{
					url: "http://localhost:4317/v1/traces",
					headers: { Authorization: "Bearer config-token" },
				},
			],
		});
	});

	it("converts legacy string endpoints at runtime", () => {
		expect(
			resolvePlaywrightOpentelemetryConfig({
				otlpEndpoint: "https://legacy-otlp.example.com/v1/traces",
				otlpHeaders: { Authorization: "Bearer legacy-otlp-token" },
				playwrightTraceApiEndpoint: "https://legacy-trace.example.com",
				playwrightTraceApiHeaders: {
					Authorization: "Bearer legacy-trace-token",
				},
			} as unknown as PlaywrightOpentelemetryConfig),
		).toMatchObject({
			otlpDestinations: [
				{
					url: "https://legacy-otlp.example.com/v1/traces",
					headers: { Authorization: "Bearer legacy-otlp-token" },
				},
			],
			playwrightTraceApiDestinations: [
				{
					url: "https://legacy-trace.example.com",
					headers: { Authorization: "Bearer legacy-trace-token" },
				},
			],
		});
	});

	it("uses singular destinations before plural destinations", () => {
		expect(
			resolvePlaywrightOpentelemetryConfig({
				otlpEndpoint: { url: "https://primary.example.com/v1/traces" },
				otlpEndpoints: [
					{ url: "https://secondary-a.example.com/v1/traces" },
					{ url: "https://secondary-b.example.com/v1/traces" },
				],
				playwrightTraceApiEndpoint: {
					url: "https://trace-primary.example.com",
				},
				playwrightTraceApiEndpoints: [
					{ url: "https://trace-secondary.example.com" },
				],
			}),
		).toMatchObject({
			otlpDestinations: [{ url: "https://primary.example.com/v1/traces" }],
			playwrightTraceApiDestinations: [
				{ url: "https://trace-primary.example.com" },
			],
		});
	});

	it("uses plural destinations when singular destinations are absent", () => {
		expect(
			resolvePlaywrightOpentelemetryConfig({
				otlpEndpoints: [
					{
						url: "https://otlp-a.example.com/v1/traces",
						headers: { "x-otlp": "a" },
					},
					{ url: "https://otlp-b.example.com/v1/traces" },
				],
				playwrightTraceApiEndpoints: [
					{
						url: "https://trace-a.example.com",
						headers: { "x-trace-api": "a" },
					},
					{ url: "https://trace-b.example.com" },
				],
			}),
		).toMatchObject({
			otlpDestinations: [
				{
					url: "https://otlp-a.example.com/v1/traces",
					headers: { "x-otlp": "a" },
				},
				{ url: "https://otlp-b.example.com/v1/traces", headers: {} },
			],
			playwrightTraceApiDestinations: [
				{
					url: "https://trace-a.example.com",
					headers: { "x-trace-api": "a" },
				},
				{ url: "https://trace-b.example.com", headers: {} },
			],
		});
	});

	it("uses OTLP environment endpoint and headers before config destinations", () => {
		process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
			"https://env-otlp.example.com/v1/traces";
		process.env.OTEL_EXPORTER_OTLP_HEADERS =
			"authorization=Bearer env-token,x-scope=a=b";

		expect(
			resolvePlaywrightOpentelemetryConfig({
				otlpEndpoint: {
					url: "https://config-otlp.example.com/v1/traces",
					headers: { Authorization: "Bearer config-token" },
				},
				otlpEndpoints: [{ url: "https://plural-otlp.example.com/v1/traces" }],
			}),
		).toMatchObject({
			otlpDestinations: [
				{
					url: "https://env-otlp.example.com/v1/traces",
					headers: {
						authorization: "Bearer env-token",
						"x-scope": "a=b",
					},
				},
			],
		});
	});

	it("uses Trace API environment endpoint and headers before config destinations", () => {
		process.env.PLAYWRIGHT_TRACE_API_ENDPOINT = "https://env-trace.example.com";
		process.env.PLAYWRIGHT_TRACE_API_HEADERS =
			"authorization=Bearer env-token,x-scope=a=b";

		expect(
			resolvePlaywrightOpentelemetryConfig({
				playwrightTraceApiEndpoint: {
					url: "https://config-trace.example.com",
					headers: { Authorization: "Bearer config-token" },
				},
				playwrightTraceApiEndpoints: [
					{ url: "https://plural-trace.example.com" },
				],
			}),
		).toMatchObject({
			playwrightTraceApiDestinations: [
				{
					url: "https://env-trace.example.com",
					headers: {
						authorization: "Bearer env-token",
						"x-scope": "a=b",
					},
				},
			],
		});
	});

	it("throws when OTLP environment headers are set without the OTLP environment endpoint", () => {
		process.env.OTEL_EXPORTER_OTLP_HEADERS = "authorization=Bearer env-token";

		expect(() =>
			resolvePlaywrightOpentelemetryConfig({
				otlpEndpoint: { url: "https://config-otlp.example.com/v1/traces" },
			}),
		).toThrowError(
			"OTEL_EXPORTER_OTLP_HEADERS is set but OTEL_EXPORTER_OTLP_ENDPOINT is not set.",
		);
	});

	it("throws when Trace API environment headers are set without the Trace API environment endpoint", () => {
		process.env.PLAYWRIGHT_TRACE_API_HEADERS = "authorization=Bearer env-token";

		expect(() =>
			resolvePlaywrightOpentelemetryConfig({
				playwrightTraceApiEndpoint: {
					url: "https://config-trace.example.com",
				},
			}),
		).toThrowError(
			"PLAYWRIGHT_TRACE_API_HEADERS is set but PLAYWRIGHT_TRACE_API_ENDPOINT is not set.",
		);
	});
});
