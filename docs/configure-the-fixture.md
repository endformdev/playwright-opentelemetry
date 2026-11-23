---
title: Configure the fixture
description: Switch your tests to the instrumented fixture to propagate trace context and capture screenshots.
sidebar:
  order: 2
---

The fixture propagates trace context to enable nested spans, and captures the screenshots shown with the trace. Import its `test` in place of Playwright's:

```ts
import { expect } from "@playwright/test";
import { test } from "playwright-opentelemetry/fixture";

test("has title", async ({ page }) => {
	await page.goto("https://playwright.dev/");

	await expect(page).toHaveTitle(/Playwright/);
});
```

## Screenshots

The fixture captures screenshots of every page in a test through Playwright's [`page.screencast`](https://playwright.dev/docs/api/class-screencast) API, sharing the browser's existing screencast rather than starting a second one. They are stored with the trace and follow the [trace retention](configure-the-reporter.md#trace-retention) settings. They don't depend on Playwright's own trace screenshots, so you can set `screenshots: false` in Playwright's `trace` option.

Tests can still use `page.screencast` themselves. To turn screenshots off, set `use.playwrightOpentelemetry.screenshots` to `false`.

> [!NOTE]
> On Playwright versions before 1.61, screenshots are read from Playwright's trace instead, so keep Playwright's trace screenshots on (for example `trace: "on"`).

## API requests

Playwright records each call a test makes through its [`request`](https://playwright.dev/docs/api-testing) fixture as a step. The step's span is also the HTTP client span for the request: it has the client span kind and the HTTP attributes, such as `http.request.method`, `url.full` and `http.response.status_code`. The span's status follows the step, so an error response the test expected doesn't mark it as failed; `error.type` still records the status code.

The fixture records them with the `request` context's [`tracing.startHar`](https://playwright.dev/docs/api/class-tracing#tracing-start-har). Playwright records one HAR at a time per context, so calling `request.tracing.startHar()` in a test fails. To record a HAR of your own, make the requests from a context you create with `playwright.request.newContext()`; the fixture doesn't record that context's requests, and its calls stay steps without HTTP attributes.

> [!NOTE]
> On Playwright versions before 1.60, which have no `tracing.startHar`, the fixture wraps `request` instead. Playwright then points each call's step at the fixture, so the reporter leaves those steps out, and the fixture records each request as a separate `HTTP` span under the test.
