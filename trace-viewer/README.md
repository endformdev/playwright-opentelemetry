# Playwright OpenTelemetry Trace Viewer

[![npm version](https://img.shields.io/npm/v/@playwright-opentelemetry/trace-viewer)](https://www.npmjs.com/package/@playwright-opentelemetry/trace-viewer)
[![license](https://img.shields.io/npm/l/@playwright-opentelemetry/trace-viewer)](https://github.com/endformdev/playwright-opentelemetry/blob/main/LICENSE)

A trace viewer designed around tests, part of [Playwright OpenTelemetry](https://github.com/endformdev/playwright-opentelemetry). A hosted copy runs at [trace.endform.dev](https://trace.endform.dev).

![One test attempt, traced from the Playwright step through the browser request into the backend span that failed](https://raw.githubusercontent.com/endformdev/playwright-opentelemetry/main/docs/assets/hero-trace.png)

## Overview

The viewer reads OpenTelemetry trace data directly rather than a proprietary test-result format. The layout uses a time-aligned flame graph with a screenshot filmstrip above it, separated into three views that match how you investigate a failure:

- **Test steps** for the Playwright test, hooks, fixtures, and actions
- **Browser spans** for navigation, routes, JavaScript, fonts, images, fetches, and other requests
- **External spans** for your instrumented application and backend services

Console messages and uncaught browser errors appear as span events on the timeline. You can search span names and attributes, inspect span details and events, jump between errors, and zoom into a time range, while the screenshots stay synchronized with the timeline and grouped by browser context and page.

## Run the trace viewer

To boot the trace viewer on `localhost:9294`:

```bash
npx @playwright-opentelemetry/trace-viewer
```

The viewer can load a local trace zip or a trace-specific API base URL such as `/playwright-otel-trace-viewer/v1/{traceId}`. Remote API loading fetches `{baseUrl}/traces` once for the merged OTLP export, derives test metadata from the root `playwright.test` span, then downloads `{baseUrl}/screenshots.zip` into the service worker when screenshots are needed.

If the viewer URL includes `traceToken`, the token is propagated to remote Trace API requests as a query parameter:

```text
https://trace.endform.dev/?traceSource=https%3A%2F%2Fexample.com%2Fplaywright-otel-trace-viewer%2Fv1%2F{traceId}&traceToken={token}
```

This loads `{baseUrl}/traces?traceToken={token}` and `{baseUrl}/screenshots.zip?traceToken={token}`.

The token can also be embedded in the `traceSource` URL, or in a Trace API URL entered in the load form. The viewer normalizes those forms back to the canonical top-level `traceToken` query parameter.

The remote API contract is:

- `GET {baseUrl}/traces` returns `{ "resourceSpans": [...] }` or `404` when the trace does not exist
- `GET {baseUrl}/screenshots.zip` returns a ZIP with root `manifest.json` and `screenshots/*`, or `404` when there are no screenshots

The service worker exposes internal per-screenshot URLs to the viewer after loading the ZIP.

## Choose which panels to show

Add a `panels` query parameter with a comma-separated list to show only some regions of the viewer, for example when embedding it in an iframe:

```text
https://trace.endform.dev/?traceSource=...&panels=viewer,filmstrip
```

| Panel | Region |
| --- | --- |
| `header` | Top bar with the test name, status, error spans, search, and time readout |
| `ruler` | Timeline ruler and test phase bar (shown automatically with any timeline panel) |
| `filmstrip` | Screenshot filmstrip |
| `viewer` | Large screenshot for the hovered or selected time |
| `steps` | Test steps timeline |
| `browser` | Browser spans timeline |
| `external` | External spans timeline |
| `details` | Span details sidebar |

Without `panels`, every panel is shown. Listing any timeline panel (`filmstrip`, `steps`, `browser`, or `external`) also shows the ruler, so `panels=viewer,filmstrip` gives a player with a screenshot, time ruler, and filmstrip. Unknown names are ignored, and a list with no known names shows every panel. A listed panel is still hidden when the trace has no data for it. The screenshot viewer sits above the details sidebar when `details` is shown, and above the timeline otherwise.

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
TRACE_VIEWER_BASE=/trace-viewer/ pnpm build
```

## Local Development

```bash
pnpm install
pnpm dev
```
