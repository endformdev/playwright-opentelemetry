---
title: View a trace
description: Open a trace in the hosted or local trace viewer and investigate a failure across test steps, browser spans, and backend spans.
sidebar:
  order: 3
---

The trace viewer shows a trace ZIP or a [Trace API](output-formats.md#trace-api) URL alongside the test's screenshots, highlighting where clicks, fills, drags, and failed actions landed on each page. Playing the test back, it holds on each of those actions for a moment, so a test that ran in seconds can still be followed; a button beside the playback speed turns the holds off.

Open the [example trace](https://trace.endform.dev/?traceSource=https%3A%2F%2Fdemo-traces.endform.dev%2Fotel-traces%2Fplaywright-tutorial%2Fpayment-server-error%2Fv2.zip) to explore a complete failure with connected Playwright, browser, and backend spans, or go to the [hosted trace viewer](https://trace.endform.dev) to load your own trace ZIP.

Or boot your own locally:

```bash
npx @playwright-opentelemetry/trace-viewer
```

This boots the trace viewer on `localhost:9294`. Then load your ZIP file or an API URL responding with telemetry.

The viewer separates the trace into three views that match how you investigate a failure:

- **Test steps** for the Playwright test, hooks, fixtures, and actions. A call on `request`, `page.request` or another `APIRequestContext` is a step that also shows the response it got
- **Browser spans** for navigation, routes, JavaScript, fonts, images, fetches, and other requests
- **External spans** for your instrumented application and backend services

Console messages and uncaught browser errors appear as span events on the timeline, and the error navigator jumps straight to failing spans and their recorded exceptions.

![The error navigator jumps straight to the failing span and its recorded exception](assets/error-navigator.png)
