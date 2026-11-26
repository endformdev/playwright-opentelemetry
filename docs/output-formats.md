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
- actions.json <-- where the test's actions landed on its pages, when recorded
- screenshots/ <-- the screenshots captured during the test run
  - {pageId}-{timestamp}.jpeg <-- pageId matches the page's `browser.page.id` span attribute
```

### `actions.json`

`actions.json` says where on the page each of the test's actions landed, such as the point a click hit and the element it was for, or the element a fill typed into, and which screenshots show it there. The trace viewer draws this over the screenshots. The file sits beside `manifest.json`, whose version it doesn't change, and readers that don't know it ignore it.

```ts
interface ActionsFile {
	version: 1;
	/** Ordered by time */
	actions: Array<{
		/** The page's id, as in the manifest and the browser.page.id span attribute */
		pageId: string;
		/** Epoch ms when the action started */
		time: number;
		/** Timestamps of the first and last of the page's screenshots that show the action in place */
		frames: { from: number; until: number };
		/** Playwright's name for the call: "click", "fill", "hover", "mouseClick", "dragAndDrop", ... */
		method: string;
		/** Where pointer input landed */
		point?: { x: number; y: number };
		/** The element the action was for */
		box?: { x: number; y: number; width: number; height: number };
		/** Where a drag started; `point` is where it ended */
		dragFrom?: { x: number; y: number };
		/** The call failed */
		failed?: true;
	}>;
}
```

To draw an action, take the latest one on a screenshot's page whose `time` has been reached, and draw its `point` and `box` if the screenshot's timestamp is from `frames.from` to `frames.until`. Every screenshot of the page in that range shows the action's element where it's drawn, and no other does. The range can begin with a screenshot from before the action, as a page that doesn't change takes no new screenshots, which is why `time` decides when the action starts to be drawn.

- Points and boxes are in CSS pixels in the page's main viewport, like the `viewportWidth` and `viewportHeight` of the manifest's screenshots. That holds for elements inside iframes too.
- Times are on the clock of the step spans and the screenshot timestamps.
- An action has at least a `point` or a `box`. A click has both, a fill only a `box`, and `page.mouse` only a `point`.
- When Playwright retried a call, such as a click on a covered element, it's the last attempt that is drawn, from when the first began.
- Actions no screenshot is known to show are left out, as are keyboard input sent to the page, assertions, calls that sent no input, and calls still running when the test ended.
- What was typed is never recorded.

The file is written when the fixture captures screenshots and could listen to Playwright as it sent input, even if no action is in it. It's missing with a browser that this process's Playwright doesn't run itself, such as one reached through `connectOptions`, and on Playwright versions before 1.63.

#### Which screenshots show an action

A screenshot doesn't always show the page as an action found it. Playwright scrolls to an element before it clicks, what the click does can move the element or take it away, and screenshots trail the page by a few milliseconds. So the fixture measures the action's element again as the call begins and ends, and each time a screenshot is captured for up to half a second after. A screenshot is counted when:

- it was taken no later than when the element was last seen in place, or than the end of the call for input without an element;
- it isn't from before the element got to its place, when the action scrolled to it or the page navigated or was resized first;
- if it's from before the element was known to be in place, no newer screenshot was taken soon enough after to still be on its way: 100 ms, or 300 ms after the action scrolled.

## Trace API

The trace viewer can also load traces from a trace-specific API base URL, for example `/playwright-otel-trace-viewer/v1/{traceId}`. That base URL must respond to the following endpoints:

- `GET {baseUrl}/traces` - merged OTLP trace export response
  - Response format `{ "resourceSpans": [...] }`
  - Returns `404` when the trace does not exist
- `GET {baseUrl}/screenshots.zip` - ZIP containing root `manifest.json`, `screenshots/*` and, when recorded, `actions.json`, or `404` when there are no screenshots

Reporter step spans in Before Hooks carry `playwright.test.phase: "before"`; spans in After Hooks and Worker Cleanup carry `playwright.test.phase: "after"`. This custom attribute is inherited by nested hooks, fixtures, and steps. Test-body steps and the root test span omit it.

The trace viewer derives base test information from the root `playwright.test` span attributes, including `test.case.title`, `playwright.test.describes`, `playwright.test.status`, `code.file.path`, and `code.line.number`.

To serve this API from your own storage, see [Deploy your own Trace API](deploy-the-trace-api.md).
