# Playwright OpenTelemetry Trace Viewer

A SolidJS single-page application for viewing Playwright test execution traces in OpenTelemetry format.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/endformdev/playwright-opentelemetry/tree/main/trace-viewer)

## Overview

This trace viewer provides a rich, interactive visualization of Playwright test runs that have been exported to OpenTelemetry format. It displays test steps, timing information, screenshots captured during execution, and additional trace data like HTTP requests.

## Deploy Your Own

### One-Click Deploy

Click the button above to deploy your own instance to Cloudflare Workers. The deployment will:

1. Clone this subdirectory to your GitHub account
2. Build the application using Vite
3. Deploy to Cloudflare Workers with static assets

### Manual Deploy

If you prefer to deploy manually:

```bash
# Clone the repository
git clone https://github.com/endformdev/playwright-opentelemetry.git
cd playwright-opentelemetry/trace-viewer

pnpm install
pnpm build
pnpm deploy
```

## Local Development

```bash
pnpm install
pnpm dev
```
