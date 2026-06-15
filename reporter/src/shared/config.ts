import { parseOtlpHeaders } from "./otel";
import type { PlaywrightTraceOption } from "./playwright-trace";

export interface PlaywrightOpentelemetryConfig {
	otlpEndpoint?: string;
	otlpHeaders?: Record<string, string>;
	playwrightTraceApiEndpoint?: string;
	playwrightTraceApiHeaders?: Record<string, string>;
	storeTraceZip?: boolean;
	trace?: PlaywrightTraceOption;
	propagateTraceHeaders?: boolean;
	serviceName?: string;
	debug?: boolean;
}

export interface PlaywrightOpentelemetryUseOptions {
	playwrightOpentelemetry?: PlaywrightOpentelemetryConfig;
}

export interface ResolvedPlaywrightOpentelemetryConfig {
	otlpEndpoint: string;
	otlpHeaders: Record<string, string>;
	playwrightTraceApiEndpoint: string;
	playwrightTraceApiHeaders: Record<string, string>;
	storeTraceZip: boolean;
	trace: PlaywrightTraceOption | null;
	propagateTraceHeaders: boolean;
	serviceName: string;
	debug: boolean;
}

export interface ResolvePlaywrightOpentelemetryConfigOptions {
	requireDestination?: boolean;
}

export function resolvePlaywrightOpentelemetryConfig(
	config: PlaywrightOpentelemetryConfig | undefined,
	options: ResolvePlaywrightOpentelemetryConfigOptions = {},
): ResolvedPlaywrightOpentelemetryConfig {
	const envOtlpHeaders = parseOtlpHeaders(
		process.env.OTEL_EXPORTER_OTLP_HEADERS,
	);
	const envTraceApiHeaders = parseOtlpHeaders(
		process.env.PLAYWRIGHT_TRACE_API_HEADERS,
	);
	const debugEnv = process.env.PLAYWRIGHT_OPENTELEMETRY_DEBUG;

	const resolvedConfig = {
		otlpEndpoint:
			process.env.OTEL_EXPORTER_OTLP_ENDPOINT || config?.otlpEndpoint || "",
		otlpHeaders: {
			...config?.otlpHeaders,
			...envOtlpHeaders,
		},
		playwrightTraceApiEndpoint:
			process.env.PLAYWRIGHT_TRACE_API_ENDPOINT ||
			config?.playwrightTraceApiEndpoint ||
			"",
		playwrightTraceApiHeaders: {
			...config?.playwrightTraceApiHeaders,
			...envTraceApiHeaders,
		},
		storeTraceZip: config?.storeTraceZip === true,
		trace: config?.trace ?? null,
		propagateTraceHeaders: config?.propagateTraceHeaders ?? true,
		serviceName:
			process.env.OTEL_SERVICE_NAME ||
			config?.serviceName ||
			"playwright-tests",
		debug:
			debugEnv === undefined
				? (config?.debug ?? false)
				: debugEnv === "1" || debugEnv === "true",
	};

	if (
		options.requireDestination === true &&
		!hasPlaywrightOpentelemetryDestination(resolvedConfig)
	) {
		throw new Error(getConfigurationErrorMessage());
	}

	return resolvedConfig;
}

function hasPlaywrightOpentelemetryDestination(
	config: ResolvedPlaywrightOpentelemetryConfig,
): boolean {
	return Boolean(
		config.otlpEndpoint ||
			config.playwrightTraceApiEndpoint ||
			config.storeTraceZip,
	);
}

function getConfigurationErrorMessage(): string {
	return (
		`playwright-opentelemetry reporter requires an OTLP endpoint, trace API endpoint, or storeTraceZip to be configured.\n\n` +
		`You can configure it using environment variables:\n\n` +
		`  export OTEL_EXPORTER_OTLP_ENDPOINT="https://api.honeycomb.io"\n` +
		`  export OTEL_EXPORTER_OTLP_HEADERS="x-honeycomb-team=YOUR_API_KEY"\n` +
		`  export OTEL_SERVICE_NAME="my-service"\n\n` +
		`Or via playwright.config.ts:\n\n` +
		`import { defineConfig } from '@playwright/test';\n` +
		`import type { PlaywrightOpentelemetryUseOptions } from 'playwright-opentelemetry/fixture';\n\n` +
		`export default defineConfig<PlaywrightOpentelemetryUseOptions>({\n` +
		`  use: {\n` +
		`    playwrightOpentelemetry: {\n` +
		`      otlpEndpoint: 'http://localhost:4317/v1/traces',\n` +
		`      otlpHeaders: {\n` +
		`        Authorization: 'Bearer YOUR_TOKEN',\n` +
		`      },\n` +
		`      serviceName: 'my-service',\n` +
		`    },\n` +
		`  },\n` +
		`  reporter: [['playwright-opentelemetry/reporter']],\n` +
		`});\n\n` +
		`Note: Environment variables take precedence over use.playwrightOpentelemetry options.\n`
	);
}
