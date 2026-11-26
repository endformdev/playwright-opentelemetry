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

Alongside the screenshots, the fixture records where each action landed: the point a click hit, the element a fill typed into. The trace viewer marks these on the screenshots. It doesn't slow the test down: Playwright already works out where its input goes, and the fixture listens in without making it wait. This needs Playwright 1.63 or later and a browser launched by the test run itself; without those, screenshots are still captured and nothing is marked on them. What a test types is never recorded. The format is described in [Output formats](output-formats.md#actionsjson).

Tests can still use `page.screencast` themselves. To turn screenshots off, set `use.playwrightOpentelemetry.screenshots` to `false`, which turns this off too.

> [!NOTE]
> On Playwright versions before 1.61, screenshots are read from Playwright's trace instead, so keep Playwright's trace screenshots on (for example `trace: "on"`).
