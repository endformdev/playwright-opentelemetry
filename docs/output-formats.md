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

`actions.json` says where on the page each of the test's actions landed: the point a click hit and the element it was for, the element a fill typed into. The trace viewer draws this over the screenshots. The file sits beside `manifest.json`, whose version it doesn't change, and readers that don't know it ignore it.

```ts
interface ActionsFile {
	version: 1;
	/** Ordered by the time of their first input */
	actions: Array<{
		/** The page's id, as in the manifest and the browser.page.id span attribute */
		pageId: string;
		/** Epoch ms when the call ended */
		end: number;
		/** The call failed */
		failed?: true;
		/** Playwright's name for the call: "click", "fill", "hover", "mouseClick", "dragAndDrop", ... */
		method: string;
		/** Every moment Playwright was about to send input, in order; never empty */
		inputs: Array<{
			/** Epoch ms */
			time: number;
			/** Where pointer input landed */
			point?: { x: number; y: number };
			/** The element the input was for */
			box?: { x: number; y: number; width: number; height: number };
		}>;
		/** See "Which frames show an action" */
		steadySince?: number;
		steadyFrom?: number;
		steadyUntil?: number;
	}>;
}
```

- Points and boxes are in CSS pixels in the page's main viewport, like the `viewportWidth` and `viewportHeight` of the manifest's screenshots. That holds for elements inside iframes too.
- Times are on the clock of the step spans and the screenshot timestamps.
- A call has several inputs when Playwright retried it, such as a click on a covered element, and when it is a drag, whose first input is where it started and whose last is where it ended.
- Input without a point or an element isn't recorded: keyboard input sent to the page has nowhere to be drawn. Neither are assertions, calls that sent no input, or calls still running when the test ended.
- What was typed is never recorded.

The file is written when the fixture captures screenshots and could listen to Playwright as it sent input, even if the test did nothing to its pages. It's missing with a browser that this process's Playwright doesn't run itself, such as one reached through `connectOptions`, and on Playwright versions before 1.63.

#### Which frames show an action

A frame doesn't always show the page as an action found it. Playwright scrolls to an element before it clicks, what the click does can move the element or take it away, and frames trail the page by a few milliseconds. So the fixture measures the element of an action's last input again, as the call begins and ends and each time a frame is captured for up to half a second after, and records what it saw:

- `steadyUntil`: the element was last seen where the input has it at this time. A frame taken later may show it somewhere else. Absent for input without an element, such as `page.mouse`.
- `steadySince`: the element was already there at this time, before the action could have moved it: as the call began for pointer input, at the input otherwise. So the action didn't scroll to it. Only recorded in Chromium, the one browser whose frame timestamps say when the frame was shown.
- `steadyFrom`: the element can't be taken to have been there any earlier than this. Either the action scrolled to it, in which case this is the input's time, or the call's end for input without a point. Or the page navigated or changed size at this time, before the input.

The trace viewer draws an action on a frame only when these say the frame shows the element in that place.

## Trace API

The trace viewer can also load traces from a trace-specific API base URL, for example `/playwright-otel-trace-viewer/v1/{traceId}`. That base URL must respond to the following endpoints:

- `GET {baseUrl}/traces` - merged OTLP trace export response
  - Response format `{ "resourceSpans": [...] }`
  - Returns `404` when the trace does not exist
- `GET {baseUrl}/screenshots.zip` - ZIP containing root `manifest.json`, `screenshots/*` and, when recorded, `actions.json`, or `404` when there are no screenshots

Reporter step spans in Before Hooks carry `playwright.test.phase: "before"`; spans in After Hooks and Worker Cleanup carry `playwright.test.phase: "after"`. This custom attribute is inherited by nested hooks, fixtures, and steps. Test-body steps and the root test span omit it.

The trace viewer derives base test information from the root `playwright.test` span attributes, including `test.case.title`, `playwright.test.describes`, `playwright.test.status`, `code.file.path`, and `code.line.number`.

To serve this API from your own storage, see [Deploy your own Trace API](deploy-the-trace-api.md).
