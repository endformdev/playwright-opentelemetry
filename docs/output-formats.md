---
title: Output formats
description: The layout of the local opentelemetry-trace.zip and the Trace API endpoints the trace viewer reads.
sidebar:
  order: 4
---

The trace viewer reads trace data in two forms: a local trace ZIP written by the reporter, and a Trace API that serves the same data over HTTP.

## `opentelemetry-trace.zip` format

When `storeTraceZip: true` and Playwright retained a trace for the test, a local copy of trace data will be stored to your results folder with the format:

```
{file.spec}:{linenumber}-{testId}-pw-otel.zip
- traces/
  - playwright-opentelemetry.json <-- the OTLP request body of all trace data collected by the reporter related to this test. Test metadata is stored on the root `playwright.test` span.
- manifest.json <-- screenshot metadata with timestamps and ZIP paths
- screenshots/ <-- the screenshots captured during the test run
  - {pageId}-{timestamp}.jpeg <-- pageId matches the page's `browser.page.id` span attribute
```

## Trace API

The trace viewer can also load traces from a trace-specific API base URL, for example `/playwright-otel-trace-viewer/v1/{traceId}`. That base URL must respond to the following endpoints:

- `GET {baseUrl}/traces` - merged OTLP trace export response
  - Response format `{ "resourceSpans": [...] }`
  - Returns `404` when the trace does not exist
- `GET {baseUrl}/screenshots.zip` - ZIP containing root `manifest.json` and `screenshots/*`, or `404` when there are no screenshots

Reporter step spans in Before Hooks carry `playwright.test.phase: "before"`; spans in After Hooks and Worker Cleanup carry `playwright.test.phase: "after"`. This custom attribute is inherited by nested hooks, fixtures, and steps. Test-body steps and the root test span omit it.

The trace viewer derives base test information from the root `playwright.test` span attributes, including `test.case.title`, `playwright.test.describes`, `playwright.test.status`, `code.file.path`, and `code.line.number`.

To serve this API from your own storage, see [Deploy your own Trace API](deploy-the-trace-api.md).
