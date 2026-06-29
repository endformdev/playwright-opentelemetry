import { parseOtlpHeaders } from "./otel";
import type { PlaywrightTraceOption } from "./playwright-trace";

export type PlaywrightOpentelemetryDestination = {
	url: string;
	headers?: Record<string, string>;
};

export type ResolvedPlaywrightOpentelemetryDestination = {
	url: string;
	headers: Record<string, string>;
};

export interface PlaywrightOpentelemetryConfig {
	otlpEndpoint?: PlaywrightOpentelemetryDestination;
	otlpEndpoints?: PlaywrightOpentelemetryDestination[];
	playwrightTraceApiEndpoint?: PlaywrightOpentelemetryDestination;
	playwrightTraceApiEndpoints?: PlaywrightOpentelemetryDestination[];
	storeTraceZip?: boolean;
	trace?: PlaywrightTraceOption;
	propagateTraceHeaders?: boolean;
	debug?: boolean;
}

export interface PlaywrightOpentelemetryUseOptions {
	playwrightOpentelemetry?: PlaywrightOpentelemetryConfig;
}

export interface ResolvedPlaywrightOpentelemetryConfig {
	otlpDestinations: ResolvedPlaywrightOpentelemetryDestination[];
	playwrightTraceApiDestinations: ResolvedPlaywrightOpentelemetryDestination[];
	storeTraceZip: boolean;
	trace: PlaywrightTraceOption | null;
	propagateTraceHeaders: boolean;
	debug: boolean;
}

export interface ResolvePlaywrightOpentelemetryConfigOptions {
	requireDestination?: boolean;
}

export function resolvePlaywrightOpentelemetryConfig(
	config: PlaywrightOpentelemetryConfig | undefined,
	options: ResolvePlaywrightOpentelemetryConfigOptions = {},
): ResolvedPlaywrightOpentelemetryConfig {
	const debugEnv = process.env.PLAYWRIGHT_OPENTELEMETRY_DEBUG;

	const resolvedConfig = {
		otlpDestinations: resolveDestinationKind({
			envEndpointName: "OTEL_EXPORTER_OTLP_ENDPOINT",
			envHeadersName: "OTEL_EXPORTER_OTLP_HEADERS",
			singular: config?.otlpEndpoint,
			plural: config?.otlpEndpoints,
		}),
		playwrightTraceApiDestinations: resolveDestinationKind({
			envEndpointName: "PLAYWRIGHT_TRACE_API_ENDPOINT",
			envHeadersName: "PLAYWRIGHT_TRACE_API_HEADERS",
			singular: config?.playwrightTraceApiEndpoint,
			plural: config?.playwrightTraceApiEndpoints,
		}),
		storeTraceZip: config?.storeTraceZip === true,
		trace: config?.trace ?? null,
		propagateTraceHeaders: config?.propagateTraceHeaders ?? true,
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
		config.otlpDestinations.some((destination) => destination.url) ||
			config.playwrightTraceApiDestinations.some(
				(destination) => destination.url,
			) ||
			config.storeTraceZip,
	);
}

function resolveDestinationKind(options: {
	envEndpointName: string;
	envHeadersName: string;
	singular?: PlaywrightOpentelemetryDestination;
	plural?: PlaywrightOpentelemetryDestination[];
}): ResolvedPlaywrightOpentelemetryDestination[] {
	const envEndpoint = process.env[options.envEndpointName];
	const envHeaders = process.env[options.envHeadersName];

	if (envHeaders && !envEndpoint) {
		throw new Error(
			`${options.envHeadersName} is set but ${options.envEndpointName} is not set.`,
		);
	}

	if (envEndpoint) {
		return [
			{
				url: envEndpoint,
				headers: parseOtlpHeaders(envHeaders),
			},
		];
	}

	if (options.singular) {
		return [resolveConfigDestination(options.singular)];
	}

	return (options.plural ?? []).map(resolveConfigDestination);
}

function resolveConfigDestination(
	destination: PlaywrightOpentelemetryDestination,
): ResolvedPlaywrightOpentelemetryDestination {
	return {
		url: destination.url,
		headers: { ...destination.headers },
	};
}

function getConfigurationErrorMessage(): string {
	return (
		`playwright-opentelemetry reporter requires an OTLP endpoint, trace API endpoint, or storeTraceZip to be configured.\n\n` +
		`You can configure it using environment variables:\n\n` +
		`  export OTEL_EXPORTER_OTLP_ENDPOINT="https://api.honeycomb.io"\n` +
		`  export OTEL_EXPORTER_OTLP_HEADERS="x-honeycomb-team=YOUR_API_KEY"\n\n` +
		`Or via playwright.config.ts:\n\n` +
		`import { defineConfig } from '@playwright/test';\n` +
		`import type { PlaywrightOpentelemetryUseOptions } from 'playwright-opentelemetry/fixture';\n\n` +
		`export default defineConfig<PlaywrightOpentelemetryUseOptions>({\n` +
		`  use: {\n` +
		`    playwrightOpentelemetry: {\n` +
		`      otlpEndpoint: {\n` +
		`        url: 'http://localhost:4317/v1/traces',\n` +
		`        headers: {\n` +
		`          Authorization: 'Bearer YOUR_TOKEN',\n` +
		`        },\n` +
		`      },\n` +
		`    },\n` +
		`  },\n` +
		`  reporter: [['playwright-opentelemetry/reporter']],\n` +
		`});\n\n` +
		`Note: Environment variables take precedence over use.playwrightOpentelemetry options.\n`
	);
}
