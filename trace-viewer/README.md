# Playwright OpenTelemetry Trace Viewer

[![npm version](https://img.shields.io/npm/v/@playwright-opentelemetry/trace-viewer)](https://www.npmjs.com/package/@playwright-opentelemetry/trace-viewer)
[![license](https://img.shields.io/npm/l/@playwright-opentelemetry/trace-viewer)](https://github.com/endformdev/playwright-opentelemetry/blob/main/LICENSE)

A trace viewer designed around tests, part of [Playwright OpenTelemetry](https://github.com/endformdev/playwright-opentelemetry). A hosted copy runs at [trace.endform.dev](https://trace.endform.dev).

![One test attempt, traced from the Playwright step through the browser request into the backend span that failed](https://raw.githubusercontent.com/endformdev/playwright-opentelemetry/main/docs/assets/hero-trace.png)

## Overview

The viewer reads OpenTelemetry trace data directly rather than a proprietary test-result format. The layout plays the test back above a time-aligned flame graph: a large screenshot of the page (or, chosen in the settings menu, a filmstrip with a row of frames per page), a control bar to step through the test or play it, and a step ruler that scrubs through the whole test and shows a screenshot filmstrip as you hover it. The flame graph below is separated into three views that match how you investigate a failure:

- **Test steps** for the Playwright test, hooks, fixtures, and actions
- **Browser spans** for navigation, routes, JavaScript, fonts, images, fetches, and other requests
- **External spans** for your instrumented application and backend services

Console messages and uncaught browser errors appear as span events on the timeline. You can search span names and attributes, inspect span details and events, jump between errors, and zoom into a time range, while the screenshots stay synchronized with the timeline and grouped by browser context and page.

## Run the trace viewer

To boot the trace viewer on `localhost:9294`:

```bash
npx @playwright-opentelemetry/trace-viewer
```

The viewer can load a local trace zip or a trace-specific API base URL such as `/playwright-otel-trace-viewer/v1/{traceId}`. Remote API loading fetches `{baseUrl}/traces` once for the merged OTLP export, derives test metadata from the root `playwright.test` span, then downloads `{baseUrl}/screenshots.zip` when screenshots are needed.

If the viewer URL includes `traceToken`, the token is propagated to remote Trace API requests as a query parameter:

```text
https://trace.endform.dev/?traceSource=https%3A%2F%2Fexample.com%2Fplaywright-otel-trace-viewer%2Fv1%2F{traceId}&traceToken={token}
```

This loads `{baseUrl}/traces?traceToken={token}` and `{baseUrl}/screenshots.zip?traceToken={token}`.

The token can also be embedded in the `traceSource` URL, or in a Trace API URL entered in the load form. The viewer normalizes those forms back to the canonical top-level `traceToken` query parameter.

The remote API contract is:

- `GET {baseUrl}/traces` returns `{ "resourceSpans": [...] }`, `404` when the trace does not exist, or `401` when the viewer isn't allowed to read it
- `GET {baseUrl}/screenshots.zip` returns a ZIP with root `manifest.json` and `screenshots/*`, or `404` when there are no screenshots

A `401` can say why with a `code` in its JSON body, and the viewer then shows a page explaining the problem instead of the load form. The codes are `token_expired`, `token_invalid` and `token_missing`. With `token_expired`, add `expiredAt` as an ISO 8601 time to show when:

```json
{ "code": "token_expired", "expiredAt": "2026-11-06T11:53:00.000Z" }
```

Any other response shows the generic error above the load form.

The service worker loads the ZIP and exposes internal per-screenshot URLs to the viewer. Where no service worker can run, the page downloads and unpacks the ZIP itself.

## Choose which panels to show

To show only some regions of the viewer, for example when embedding it in an iframe, add a `view` query parameter with a preset:

```text
https://trace.endform.dev/?traceSource=...&view=player
```

| View     | Panels                      |
| -------- | --------------------------- |
| `full`   | Every panel                 |
| `player` | `viewer`, `ruler`           |
| `spans`  | Every panel except `viewer` |

For full control, list the panels yourself with a comma-separated `panels` query parameter. It overrides `view`:

```text
https://trace.endform.dev/?traceSource=...&panels=viewer,ruler,steps
```

| Panel      | Region                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------ |
| `header`   | Top bar with the test name, status, error spans, search, viewer settings, and time readout |
| `ruler`    | Step ruler: the whole test with its steps and hooks, with a screenshot filmstrip on hover  |
| `viewer`   | Step viewer: the big screen or filmstrip, with a bar of step, playback and page controls   |
| `steps`    | Test steps timeline                                                                        |
| `browser`  | Browser spans timeline                                                                     |
| `external` | External spans timeline                                                                    |
| `details`  | Span details sidebar                                                                       |

## Add an action to an embedded player

When embedding the viewer in an iframe, add an `action` query parameter to put a button at the end of the player's control bar. For now the only action is `expand`:

```text
https://trace.endform.dev/?traceSource=...&view=player&action=expand
```

The viewer doesn't run the action itself. Clicking the button posts `{ type: "trace-viewer:action", action: "expand" }` to the embedding page, which decides what to do, for example open a modal holding the same trace in the `full` view. The button doesn't show when the viewer isn't in an iframe.

The message can be sent to any origin, so check who sent it:

```ts
window.addEventListener("message", (event) => {
	if (event.source !== iframe.contentWindow) return;
	if (event.origin !== "https://trace.endform.dev") return;
	if (event.data?.type !== "trace-viewer:action") return;
	if (event.data.action === "expand") openExpandedTrace();
});
```

Without `view` or `panels`, the viewer settings saved in the browser decide what is shown. With them, the URL decides instead: saved settings are ignored for that page, and changes made in the settings menu there are not saved. Unknown panel names are ignored. A `panels` list with no known names falls back to `view`, and an unknown `view` falls back to the saved settings. A listed panel is still hidden when the trace has no data for it. Sections with no data are disabled in the settings menu.

## Compare with another trace

Add a second trace to show its screenshots beside this one's on the big screen, for example the last passing run of a test that just failed:

| Parameter       | Meaning                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------- |
| `compareSource` | The trace to compare with: a Trace API base URL or a `.zip` URL, read like `traceSource`. |
| `compareToken`  | Token for a Trace API `compareSource`, sent as `traceToken` on its requests.              |
| `compareLabel`  | Caption over the comparison, at most 80 characters. Defaults to "Baseline".               |

```text
https://trace.endform.dev/?traceSource=https%3A%2F%2Fapi.example.com%2Fv1%2F{failingTraceId}&traceToken={tokenA}
  &compareSource=https%3A%2F%2Fapi.example.com%2Fv1%2F{passingTraceId}&compareToken={tokenB}
  &compareLabel=Last%20passing%20run%20on%20main&view=player
```

Each trace gets only its own token: `traceToken` never goes to `compareSource`, nor `compareToken` to `traceSource`, so the two can live on different origins. A token embedded in `compareSource` is moved to `compareToken`. The comparison is shown on the left, this run on the right, and a button in the control bar hides it. If it can't be loaded, the trace is shown as usual with a notice in its place. Loading another trace from the viewer's form drops the comparison.

The two runs never take the same time, so the viewer works out which moment of the comparison goes with each moment of this run from the steps they share. Steps that match start and end together; between them the comparison is slowed down or sped up evenly to fit. Two steps match when they do the same thing to the same locator, even with another value, so a fill with a generated email still matches. Source lines aren't compared, since editing the test moves them. Actions and expects match even when the `test.step` blocks around them were renamed or removed. When either run failed, the comparison plays on from the start of the step that failed to its settled result of that step, and holds there. The caption says "No matching step" when the step on show has no counterpart, and "Approximate timing" when no step matched and only the whole test body is stretched to fit.

## Embed in a sandboxed iframe

Remote API traces work inside `<iframe sandbox="allow-scripts allow-forms">`, which gives the viewer an opaque origin (`null`) and no service worker. The viewer detects this and needs no configuration, but two things have to be readable from origin `null`:

- The viewer's assets. Served with `Access-Control-Allow-Origin: *` on `/assets/*` by default on Cloudflare (through `public/_headers`) and by `npx @playwright-opentelemetry/trace-viewer`. On any other host, including a custom base path behind a proxy, add that header yourself. Without it the sandboxed page stays blank.
- The Trace API. Set [`corsOrigin: "*"`](../trace-api/README.md#configuration) and pass a `traceToken`, because a sandboxed frame can't send cookies this way. The viewer only forwards the token: [validate it in your Trace API](../trace-api/README.md#low-level-building-blocks-with-authentication), which doesn't check it for you.

Local and remote trace ZIPs still need a service worker, so they can't be loaded there.

Messages from an [action](#add-an-action-to-an-embedded-player) arrive with the origin `"null"`, so the `event.origin` check in that section rejects them. Any sandboxed page has that origin too, so don't allow `"null"` instead. Check which frame sent the message:

```ts
window.addEventListener("message", (event) => {
	if (event.source !== iframe.contentWindow) return;
	if (event.data?.type !== "trace-viewer:action") return;
	if (event.data.action === "expand") openExpandedTrace();
});
```

## Deploy Your Own

### Cloudflare

You can deploy a copy of the trace viewer to Cloudflare:

```bash
git clone https://github.com/endformdev/playwright-opentelemetry.git
cd playwright-opentelemetry/trace-viewer

pnpm install
pnpm build
pnpm deploy
```

### Custom Base Path (Optional)

If you want to build with absolute paths for a specific deployment location:

```bash
VITE_TRACE_VIEWER_BASE=/trace-viewer/ pnpm build
```

## Local Development

```bash
pnpm install
pnpm dev
```
