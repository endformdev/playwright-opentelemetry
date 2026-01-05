# Playwright OpenTelemetry Trace Viewer

A SolidJS single-page application for viewing Playwright test execution traces in OpenTelemetry format.

## Overview

This trace viewer provides a rich, interactive visualization of Playwright test runs that have been exported to OpenTelemetry format. It displays test steps, timing information, screenshots captured during execution, and additional trace data like HTTP requests.

## Run the trace viewer

To boot the trace viewer on `localhost:9294`:

```bash
npx @playwright-opentelemetry/trace-viewer
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
TRACE_VIEWER_BASE=/trace-viewer/ pnpm build
```

## Local Development

```bash
pnpm install
pnpm dev
```
