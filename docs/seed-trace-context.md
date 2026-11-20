---
title: Seed trace IDs from a host
description: Let the program that runs your tests choose each test attempt's trace ID before the attempt starts.
sidebar:
  order: 6
---

This page is for hosts that run Playwright tests, such as a custom runner or a test orchestrator, and need to know a test attempt's trace ID before it starts. Most users don't need it: the reporter puts the trace ID in the [`playwrightOpentelemetryTraceId` annotation](configure-the-reporter.md#using-trace-ids-in-other-reporters).

The annotation isn't enough when:

- The host runs the reporter in a separate process, so it never sees the annotation.
- The attempt fails before the fixture runs. The fixture creates the trace context in a test-scoped fixture, which Playwright sets up only after worker fixtures and `beforeAll` hooks. If one of those fails or times out, the reporter makes up a trace ID that only the annotation carries.

A host can instead choose the IDs itself by writing them to a file that the fixture and the reporter both read.

## The trace context file

For each test attempt, the fixture and the reporter share a folder:

```
<project outputDir>/.playwright-opentelemetry/<testId>-<retry>/
```

- `<project outputDir>` is the project's resolved, absolute `outputDir` (`FullProject.outputDir` in the reporter API), not the test's own output directory.
- `<testId>` is Playwright's test ID: `TestCase.id` in the reporter API, `TestInfo.testId` in a worker.
- `<retry>` is the attempt's retry index, starting at `0`: `TestResult.retry` or `TestInfo.retry`. Each retry is a separate attempt with its own folder and its own trace.

To choose an attempt's IDs, write `trace-context.json` in that folder:

```json
{
	"traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
	"rootSpanId": "00f067aa0ba902b7"
}
```

- `traceId` is the attempt's OpenTelemetry trace ID: 32 hex characters.
- `rootSpanId` is the span ID of the attempt's test span: 16 hex characters. The step, fixture and browser spans are its children, so the host has to choose it too.

Uppercase hex is accepted but used as written. Write lowercase, random, non-zero IDs, as [W3C Trace Context](https://www.w3.org/TR/trace-context/) requires for the `traceparent` header the fixture sends from the browser.

Hosts written in JavaScript can build the path from the package rather than copying the layout:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import {
	fixtureHandoffDir,
	TRACE_CONTEXT_HANDOFF_FILE,
	type TraceContextHandoff,
} from "playwright-opentelemetry/host";

const dir = fixtureHandoffDir(projectOutputDir, testId, retry);
const traceContext: TraceContextHandoff = { traceId, rootSpanId };
await fs.mkdir(dir, { recursive: true });
await fs.writeFile(
	path.join(dir, TRACE_CONTEXT_HANDOFF_FILE),
	JSON.stringify(traceContext),
);
```

## When to write it

Write the file:

- after Playwright clears the project's output directory at the start of the run, which deletes anything written earlier, and
- before the attempt's test-scoped fixtures run. In practice, write it before the host sends the attempt to a worker.

A reporter's `onTestBegin` is too late: it runs in the runner process while the worker is already setting up the test. Write a retry's file before the retry is sent to a worker, too.

## What reads it

- **The fixture** uses the IDs for the attempt's trace context: its spans, the `traceparent` header and the Trace API's expected-trace marker. It leaves a valid file as it is. With `attachFixtureData`, it still reads the file and attaches those IDs to the test result.
- **The reporter** reads the file in `onTestEnd` and uses the IDs for the test span and the annotation, including for an attempt that failed before the fixture ran.

If the file isn't valid JSON with a 32-character hex `traceId` and a 16-character hex `rootSpanId`, the fixture logs a warning, creates new IDs and overwrites the file with them. The reporter then uses the new IDs, which the host doesn't know. If the attempt fails before the fixture runs, the reporter reads the invalid file itself and fails on anything that isn't JSON with string `traceId` and `rootSpanId` fields, so check the IDs before writing them.

Without a file, the fixture creates new IDs as usual.

## Cleanup

In `onTestEnd`, the reporter deletes the attempt's folder, whether or not it reports the test. Don't expect to read the file back afterwards: keep the IDs the host chose. In `onEnd`, the reporter also removes the `.playwright-opentelemetry` folder if it is empty.

The folder layout and file format on this page are supported for hosts. Any change to them will be called out in the release notes.
