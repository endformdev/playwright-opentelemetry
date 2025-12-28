# Playwright OpenTelemetry Trace Viewer

A SolidJS single-page application for viewing Playwright test execution traces in OpenTelemetry format.

## Overview

This trace viewer provides a rich, interactive visualization of Playwright test runs that have been exported to OpenTelemetry format. It displays test steps, timing information, screenshots captured during execution, and additional trace data like HTTP requests.

## Features

- **Test Overview**: Display test name, duration, and outcome (passed/failed/skipped)
- **Screenshot Filmstrip**: Timeline of screenshots captured during test execution
- **Steps Timeline**: Flame graph visualization of nested test steps and actions
- **Trace Data**: HTTP requests, console logs, and other spans from the test run
- **Details Panel**: Context-sensitive details for selected/hovered items
- **Flexible Data Loading**: Load traces from ZIP files or remote URLs

## Architecture

### Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Test Header                                │
│                    (test name, duration, outcome)                       │
├───────────────────────────────────────────────────┬─────────────────────┤
│                    Main Panel (70-80%)            │  Details Panel      │
│  ┌─────────────────────────────────────────────┐  │  (20-30%)           │
│  │              Screenshot Filmstrip           │  │                     │
│  │  [img] [img] [img] [img] [img] [img] [img]  │  │  ┌───────────────┐  │
│  └─────────────────────────────────────────────┘  │  │               │  │
│  ┌─────────────────────────────────────────────┐  │  │  Contextual   │  │
│  │              Steps Timeline                 │  │  │  Details      │  │
│  │  ┌─────────────────────────────────────┐    │  │  │               │  │
│  │  │ Test: login flow                    │    │  │  │  - Step info  │  │
│  │  │  ┌──────────────────────────────┐   │    │  │  │  - Screenshot │  │
│  │  │  │ Step: navigate to login      │   │    │  │  │  - Request    │  │
│  │  │  └──────────────────────────────┘   │    │  │  │    details    │  │
│  │  │  ┌────────────────────────────────┐ │    │  │  │               │  │
│  │  │  │ Step: fill credentials         │ │    │  │  │               │  │
│  │  │  │  ┌─────────┐ ┌──────────────┐  │ │    │  │  │               │  │
│  │  │  │  │ fill    │ │ fill         │  │ │    │  │  │               │  │
│  │  │  └──┴─────────┴─┴──────────────┴──┘ │    │  │  │               │  │
│  │  └─────────────────────────────────────┘    │  │  │               │  │
│  └─────────────────────────────────────────────┘  │  │               │  │
│  ┌─────────────────────────────────────────────┐  │  │               │  │
│  │              Traces Panel                   │  │  │               │  │
│  │  GET /api/login        200  45ms            │  │  │               │  │
│  │  POST /api/session     201  120ms           │  │  └───────────────┘  │
│  │  console.log: "User logged in"              │  │                     │
│  └─────────────────────────────────────────────┘  │                     │
└───────────────────────────────────────────────────┴─────────────────────┘
```


### Trace API

Pass a URL via query parameter: `?url=https://example.com/traces/abc123`

The application will fetch:
- `GET {baseUrl}/otlp-traces` - list OpenTelemetry traces
- `GET {baseUrl}/otlp-traces/pw-reporter-trace.json` - Traces captured by playwright opentelemetry reporter
- `GET {baseUrl}/screenshots` - List screenshots
- `GET {baseUrl}/screenshots/{filename}` - Individual screenshots
