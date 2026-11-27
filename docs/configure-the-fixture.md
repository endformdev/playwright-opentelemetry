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

The fixture captures screenshots of every page in a test through Playwright's [`page.screencast`](https://playwright.dev/docs/api/class-screencast) API, sharing the browser's existing screencast rather than starting a second one. Alongside screenshots, it records where pointer and element actions (such as clicks, fills, and drags) landed so the trace viewer can highlight them; typed input values are not recorded. Both are stored with the trace and follow the [trace retention](configure-the-reporter.md#trace-retention) settings. They don't depend on Playwright's own trace screenshots, so you can set `screenshots: false` in Playwright's `trace` option.

Tests can still use `page.screencast` themselves. To turn screenshots (and action highlights) off, set `use.playwrightOpentelemetry.screenshots` to `false`.

> [!NOTE]
> On Playwright versions before 1.61, screenshots are read from Playwright's trace instead, so keep Playwright's trace screenshots on (for example `trace: "on"`). Action highlights require Playwright 1.63 or newer running an in-process browser; with older versions or remote browsers, screenshots are still captured without action highlights.
