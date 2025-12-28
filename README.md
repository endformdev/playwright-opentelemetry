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

### Showing a trace


```
npx @playwright-opentelemetry/trace-viewer my-file.zip
```

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

The trace viewer can also load traces from APIs that respond to the following endpoints

- `GET {baseUrl}/test.json` - Base test information
- `GET {baseUrl}/opentelemetry-protocol` - list OpenTelemetry traces
	- Response format `{ "jsonFiles": ["playwright-opentelemetry.json", "other-file.json"] }`
- `GET {baseUrl}/opentelemetry-protocol/playwright-opentelemetry.json` - Traces captured by playwright opentelemetry reporter
- `GET {baseUrl}/opentelemetry-protocol/{traceFile}` - Other traces captured during the test run
- `GET {baseUrl}/screenshots` - List screenshots
	- Response format `{ "screenshots": [ { "timestamp": 1766929201038, "file": "page@xxxbbb-1766929201038.jpeg" }] }`
- `GET {baseUrl}/screenshots/{filename}` - Individual screenshots



### `test.json`

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

## Contributing

### Developing `playwright-opentelemetry`

- `pnpm dev` starts a dev server that outputs `dist/index.mjs`
- `pnpm build` otherwise creates a one-off compiled build
- `pnpm test:unit` to run the unit tests
- `pnpm test:e2e` uses the compiled reporter output
- `pnpm typecheck` for typescript
- `pnpm format` to format files

### Releasing

```
pnpx bumpp
```
