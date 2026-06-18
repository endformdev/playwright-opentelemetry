# Playwright Opentelemetry Reporter

We're building a reporter for Playwright that can export traces and spans in opentelemetry format.

We're just getting started, this project is in early development. Reach out if you're interested in learning more!

## Usage

Two things need to be set up for complete opentelemetry tracing:

1. A reporter that sends traces to your provider of choice
2. A fixture that propagates opentelemetry trace headers to enable nested spans

### Configure the reporter

```ts
import { defineConfig, devices } from "@playwright/test";
import type {
	PlaywrightOpentelemetryConfig,
	PlaywrightOpentelemetryUseOptions,
} from "playwright-opentelemetry/fixture";

const playwrightOpentelemetry: PlaywrightOpentelemetryConfig = {
	// Or use environment variable OTEL_EXPORTER_OTLP_ENDPOINT
	otlpEndpoint: "https://api.eu1.honeycomb.io/v1/traces",
	// Or use environment variable OTEL_EXPORTER_OTLP_HEADERS
	otlpHeaders: {
		"x-honeycomb-team": "xxxabc",
	},
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
	use: {
		playwrightOpentelemetry,
	},
	// Playwright trace retention. OpenTelemetry output follows this unless
	// playwrightOpentelemetry.trace is configured above.
	trace: "retain-on-failure",
	reporter: [["playwright-opentelemetry/reporter"]],
    // ... rest of Playwright config
});
```

### Configure the fixture

```ts
import { expect } from "@playwright/test";
import { test } from "playwright-opentelemetry/fixture";

test("has title", async ({ page }) => {
	await page.goto("https://playwright.dev/");

	await expect(page).toHaveTitle(/Playwright/);
});
```

### Add screenshots

```ts
import { defineConfig, devices } from "@playwright/test";
import type { PlaywrightOpentelemetryUseOptions } from "playwright-opentelemetry/fixture";

export default defineConfig<PlaywrightOpentelemetryUseOptions>({
    // ... other Playwright config
	use: {
		playwrightOpentelemetry: {
			storeTraceZip: true,
		},
		// Most performant method of screenshot collection
		trace: {
			mode: "on",
			screenshots: true,
			snapshots: false,
			sources: false,
			attachments: false,
		},
		// Otherwise this also does the trick!
		// trace: "on"
	}
    // ... rest of Playwright config
});
```

### Trace retention

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

When `playwrightOpentelemetry.trace` keeps a test but Playwright's own `trace` setting does not retain a trace attachment, OpenTelemetry spans are still exported, but Playwright screenshots are not available in the local or Trace API zip output.

### Showing a trace

Go to the [hosted trace viewer](https://trace.endform.dev).

Or boot your own locally:

```bash
npx @playwright-opentelemetry/trace-viewer
```
This boots the trace viewer on `localhost:9294`.

Then load your zip file or an API url responding with telemetry.

### Using trace IDs in other reporters

Reporters configured after `playwright-opentelemetry/reporter` can read the trace ID from `TestResult.annotations` in `onTestEnd`:

```ts
const traceId = result.annotations.find(
	(annotation) => annotation.type === "playwrightOpentelemetryTraceId",
)?.description;
```

The annotation type is `playwrightOpentelemetryTraceId`. Its `description` is the 32-character OpenTelemetry trace ID, and it is only present when a trace was created for that test attempt.

## Output Formats

### `opentelemetry-trace.zip` format

When `storeTraceZip: true` and Playwright retained a trace for the test, a local copy of trace data will be stored to your results folder with the format:

```
{file.spec}:{linenumber}-{testId}-pw-otel.zip
- traces/
  - playwright-opentelemetry.json <-- the OTLP request body of all trace data collected by the reporter related to this test. Test metadata is stored on the root `playwright.test` span.
- manifest.json <-- screenshot metadata with timestamps and ZIP paths
- screenshots/ <-- any screenshots collected during the test run
  - {page}@{pageId}-{timestamp}.jpeg
```

### Trace API

The trace viewer can also load traces from a trace-specific API base URL, for example `/playwright-otel-trace-viewer/v1/{traceId}`. That base URL must respond to the following endpoints:

- `GET {baseUrl}/traces` - merged OTLP trace export response
	- Response format `{ "resourceSpans": [...] }`
	- Returns `404` when the trace does not exist
- `GET {baseUrl}/screenshots.zip` - ZIP containing root `manifest.json` and `screenshots/*`, or `404` when there are no screenshots

The trace viewer derives base test information from the root `playwright.test` span attributes, including `test.case.title`, `playwright.test.describes`, `playwright.test.status`, `code.file.path`, and `code.line.number`.

### Deploying Your Own Trace API

The `@playwright-opentelemetry/trace-api` package provides a customizable H3-based library for storing and serving traces from S3-compatible storage. You can deploy it to Cloudflare Workers, Deno, Bun, Node.js, or any platform supporting web-standard Request/Response handlers.

See the [trace-api README](trace-api/README.md) for installation, usage examples, and deployment instructions.

## Contributing

### Developing `playwright-opentelemetry`

Root level commands are:

- `pnpm test` to run the unit tests
- `pnpm typecheck` for typescript
- `pnpm format` to format files

Other instructions for the [reporter](reporter/README.md) and the [trace-viewer](trace-viewer/README.md) are available in their respective READMEs.

### Releasing

To release all packages: `playwright-opentelemetry`, `@playwright-opentelemetry/trace-viewer` and `@playwright-opentelemetry/trace-api`:

```
pnpm release
```

This bumps all packages to the same version, commits, tags, and pushes to trigger the publish workflow.
