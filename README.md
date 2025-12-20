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
import type { PlaywrightOpentelemetryReporterOptions } from "playwright-opentelemetry/reporter";

export default defineConfig({
    // ... other Playwright config
	reporter: [
		[
			"playwright-opentelemetry/reporter",
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
npx bumpp
```