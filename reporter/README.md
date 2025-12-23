# `playwright-opentelemetry`

A combination of a Playwright reporter and a fixture that allows you to create opentelemetry spans for playwright end-to-end tests.

For more information on getting started, check out the main [readme](../README.md).

## `opentelemetry-trace.zip` format

When running the reporter with `storeTraceZip: true`, a local copy of trace data will be stored to your results folder with the format:

```
{file.spec}:{linenumber}-{testId}-pw-otel.zip
- oltp-traces/
  - pw-reporter-trace.json <-- the oltp request body of all trace data collected by the reporter related to this test.
- screenshots/ <-- any screenshots collected during the test run
  - {page}@{pageId}-{timestamp}.jpeg
```