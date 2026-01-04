# Playwright Opentelemetry Reporter

We're building a reporter for Playwright that can export traces and spans in opentelemetry format.

We're just getting started, this project is in early development. Reach out if you're interested in learning more!

## Usage

Two things need to be set up for complete opentelemetry tracing:

1. A reporter that sends traces to your provider of choice
2. A fixture that propogates opentelemetry trace headers to enable nested spans

### Configure the reporter

```ts
import { defineConfig, devices } from "@playwright/test";
import type { PlaywrightOpentelemetryReporterOptions } from "playwright-opentelemetry";

export default defineConfig({
    // ... other Playwright config
	reporter: [
		[
			"playwright-opentelemetry",
			{
                // Or use environment variable OTEL_EXPORTER_OTLP_ENDPOINT
                otlpEndpoint: "https://api.eu1.honeycomb.io/v1/traces",
                // Or use environment variable OTEL_EXPORTER_OTLP_HEADERS
	            otlpHeaders: {
                    "x-honeycomb-team": "xxxabc",
                }
				// Or output a opentelemetry report zip
				storeTraceZip: true,
			} satisfies PlaywrightOpentelemetryReporterOptions,
		],
	],
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
import type { PlaywrightOpentelemetryReporterOptions } from "playwright-opentelemetry";

export default defineConfig({
    // ... other Playwright config
	use: {
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

### Showing a trace

Go to the [hosted trace viewer](https://trace.endform.dev).

Or boot your own locally:

```bash
npx @playwright-opentelemetry/trace-viewer
```
This boots the trace viewer on `localhost:9294`.

Then load your zip file or an API url responding with telemetry.

## Output Formats

### `opentelemetry-trace.zip` format

When running the reporter with `storeTraceZip: true`, a local copy of trace data will be stored to your results folder with the format:

```
{file.spec}:{linenumber}-{testId}-pw-otel.zip
- test.json <-- Base test information
- opentelemetry-protocol/
  - playwright-opentelemetry.json <-- the otlp request body of all trace data collected by the reporter related to this test.
- screenshots/ <-- any screenshots collected during the test run
  - {page}@{pageId}-{timestamp}.jpeg
```

### Trace API

The trace viewer can also load traces from APIs that respond to the following endpoints:

- `GET {baseUrl}/test.json` - Base test information
- `GET {baseUrl}/opentelemetry-protocol` - list OpenTelemetry traces
	- Response format `{ "jsonFiles": ["playwright-opentelemetry.json", "other-file.json"] }`
- `GET {baseUrl}/opentelemetry-protocol/playwright-opentelemetry.json` - Traces captured by playwright opentelemetry reporter
- `GET {baseUrl}/opentelemetry-protocol/{traceFile}` - Other traces captured during the test run
- `GET {baseUrl}/screenshots` - List screenshots
	- Response format `{ "screenshots": [ { "timestamp": 1766929201038, "file": "page@xxxbbb-1766929201038.jpeg" }] }`
- `GET {baseUrl}/screenshots/{filename}` - Individual screenshots

#### `test.json`

```json
{
	"name": "User can log in to the homepage",
	"describes": ["When a user is logged out"],
	"file": "homepage/login.spec.ts",
	"line": 9,
	"status": "passed",
	"traceId": "7709187832dca84f02f413a312421586",
	"startTimeUnixNano": "1766927492260000000",
	"endTimeUnixNano": "1766927493119000000",
}
```

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

To release both `playwright-opentelemetry` and `@playwright-opentelemetry/trace-viewer`:

```
pnpm release
```

This bumps both packages to the same version, commits, tags, and pushes to trigger the publish workflow.
