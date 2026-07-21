# playwright-opentelemetry

**Trace your Playwright tests across the entire stack.**

[![npm version](https://img.shields.io/npm/v/playwright-opentelemetry)](https://www.npmjs.com/package/playwright-opentelemetry)
[![license](https://img.shields.io/npm/l/playwright-opentelemetry)](https://github.com/endformdev/playwright-opentelemetry/blob/main/LICENSE)

A Playwright **reporter** and **fixture** that record each test attempt as OpenTelemetry spans, capture the browser activity around it, and propagate W3C trace context (`traceparent`) from browser requests into your instrumented backend. The result is one connected trace, rooted at a named test, reaching from the Playwright step through the browser request into every instrumented service the user journey touched.

![One test attempt, traced from the Playwright step through the browser request into the backend span that failed](https://raw.githubusercontent.com/endformdev/playwright-opentelemetry/main/docs/assets/hero-trace.png)

```text
Playwright test
    -> test step
        -> browser request + traceparent
            -> application request
                -> service call
                    -> database query
```

- The **reporter** turns each retained test attempt into a root `playwright.test` span, with steps, hooks, fixtures, and actions as child `playwright.test.step` spans.
- The **fixture** records page navigations, browser requests, `request` fixture activity, worker `fetch` activity, console messages, and uncaught page errors under a `playwright-browser` service, and injects the `traceparent` header that makes backend spans children of the test.

## Quick start

```bash
npm install --save-dev playwright-opentelemetry
```

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";
import type {
	PlaywrightOpentelemetryConfig,
	PlaywrightOpentelemetryUseOptions,
} from "playwright-opentelemetry/fixture";

const playwrightOpentelemetry: PlaywrightOpentelemetryConfig = {
	// Send to any OTLP destination, or set OTEL_EXPORTER_OTLP_ENDPOINT
	otlpEndpoint: {
		url: "https://api.eu1.honeycomb.io/v1/traces",
		headers: { "x-honeycomb-team": "your-api-key" },
	},
	// Or write a local OpenTelemetry trace ZIP instead of, or alongside, OTLP.
	storeTraceZip: true,
};

export default defineConfig<PlaywrightOpentelemetryUseOptions>({
	reporter: [["playwright-opentelemetry/reporter"]],
	use: {
		playwrightOpentelemetry,
		// Screenshots come from Playwright's retained trace.
		trace: "retain-on-failure",
	},
});
```

Switch your tests to the instrumented fixture:

```ts
import { expect } from "@playwright/test";
import { test } from "playwright-opentelemetry/fixture";

test("has title", async ({ page }) => {
	await page.goto("https://playwright.dev/");

	await expect(page).toHaveTitle(/Playwright/);
});
```

View the resulting trace in the [hosted trace viewer](https://trace.endform.dev), or locally:

```bash
npx @playwright-opentelemetry/trace-viewer
```

## Documentation

Full documentation, including trace retention options, screenshot capture, multiple OTLP destinations, output formats, and the self-hostable Trace API, lives in the [project README](https://github.com/endformdev/playwright-opentelemetry#usage).

## Developing the reporter / fixture

- `pnpm dev` starts a dev server that outputs `dist/index.mjs`
- `pnpm build` otherwise creates a one-off compiled build
- `pnpm test:e2e` uses the compiled reporter output

## License

[Apache-2.0](https://github.com/endformdev/playwright-opentelemetry/blob/main/LICENSE), built by [Endform](https://endform.dev).
