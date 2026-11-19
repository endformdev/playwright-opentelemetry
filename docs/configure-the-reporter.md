---
title: Configure the reporter
description: Send each retained test attempt to OTLP destinations or a local trace ZIP, and choose which attempts are kept.
sidebar:
  order: 1
---

The reporter sends traces to your provider of choice. For complete OpenTelemetry tracing, also switch your tests to the [fixture](configure-the-fixture.md), which propagates trace context to enable nested spans.

```ts
import { defineConfig, devices } from "@playwright/test";
import type {
	PlaywrightOpentelemetryConfig,
	PlaywrightOpentelemetryUseOptions,
} from "playwright-opentelemetry/fixture";

const playwrightOpentelemetry: PlaywrightOpentelemetryConfig = {
	// Or use environment variable OTEL_EXPORTER_OTLP_ENDPOINT
	otlpEndpoint: {
		url: "https://api.eu1.honeycomb.io/v1/traces",
		// Or use environment variable OTEL_EXPORTER_OTLP_HEADERS
		headers: {
			"x-honeycomb-team": "xxxabc",
		},
	},
	// Add more OTLP traces endpoints:
	// otlpEndpoints: [{ url: "https://collector-a.example.com/v1/traces", trace: "on" }],
	// Or output an opentelemetry report zip
	storeTraceZip: true,
	// Defaults to true. When enabled, browser requests receive a W3C
	// traceparent header that makes downstream spans children of the
	// Playwright-generated test trace. Export Playwright telemetry to the
	// same backend as your app telemetry to avoid missing root spans.
	propagateTraceHeaders: true,
	// Optional. Defaults to following Playwright's trace setting below.
	// trace: "on",
};

export default defineConfig<PlaywrightOpentelemetryUseOptions>({
	// ... other Playwright config
	reporter: [["playwright-opentelemetry/reporter"]],
	use: {
		playwrightOpentelemetry,
		// Playwright trace retention. OpenTelemetry output follows this unless
		// playwrightOpentelemetry.trace is configured above.
		trace: "retain-on-failure",
	},
	// ... rest of Playwright config
});
```

The current implementation sends OTLP/HTTP JSON payloads to configurable trace endpoints, so check that your destination accepts that transport before you wire it up.

## Trace retention

By default, reporter output follows Playwright trace retention. If Playwright does not produce or retain a `trace` attachment for a test, `playwright-opentelemetry` will not send OTLP data, upload Trace API data, or write a local `*-pw-otel.zip` for that test.

Configure `use.trace` to control when Playwright traces and OpenTelemetry output are produced:

- `trace: "on"` exports every test.
- `trace: "retain-on-failure"` exports failed or unexpected tests.
- `trace: "on-first-retry"` exports first retries.
- `trace: "off"` exports nothing.

To control OpenTelemetry output independently, set `use.playwrightOpentelemetry.trace`. It accepts the same values as Playwright's `use.trace` and overrides Playwright's trace setting for both the fixture and reporter:

```ts
export default defineConfig<PlaywrightOpentelemetryUseOptions>({
	use: {
		playwrightOpentelemetry: {
			trace: "on",
		},
		trace: "retain-on-failure",
	},
});
```

You can also override trace retention for individual OpenTelemetry destinations. A destination-level `trace` setting overrides `use.playwrightOpentelemetry.trace` for that endpoint only. For example, you can keep local trace zips limited to failures while sending every test attempt to a specific OTLP backend:

```ts
export default defineConfig<PlaywrightOpentelemetryUseOptions>({
	use: {
		playwrightOpentelemetry: {
			trace: "retain-on-failure",
			storeTraceZip: true,
			otlpEndpoint: {
				url: "https://all-traces.example.com/v1/traces",
				trace: "on",
			},
		},
		trace: "retain-on-failure",
	},
});
```

> [!NOTE]
> `storeTraceZip` follows only the top-level trace setting.

## Using trace IDs in other reporters

Reporters configured after `playwright-opentelemetry/reporter` can read the trace ID from `TestResult.annotations` in `onTestEnd`:

```ts
const traceId = result.annotations.find(
	(annotation) => annotation.type === "playwrightOpentelemetryTraceId",
)?.description;
```

The annotation type is `playwrightOpentelemetryTraceId`. Its `description` is the 32-character OpenTelemetry trace ID, and it is only present when a trace was created for that test attempt.
