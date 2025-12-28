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

### Directory Structure

```
src/
├── index.tsx                    # Entry point
├── index.css                    # Global styles (Tailwind)
├── App.tsx                      # Root component, layout orchestration
│
├── components/                  # UI Components (presentational)
│   ├── layout/
│   │   ├── MainPanel.tsx        # Left 70-80% container
│   │   ├── DetailsPanel.tsx     # Right sidebar container
│   │   └── SplitPane.tsx        # Resizable split pane
│   │
│   ├── header/
│   │   └── TestHeader.tsx       # Test name, duration, outcome
│   │
│   ├── filmstrip/
│   │   ├── Filmstrip.tsx        # Screenshot timeline strip
│   │   └── FilmstripFrame.tsx   # Individual screenshot thumbnail
│   │
│   ├── timeline/
│   │   ├── StepsTimeline.tsx    # Flame graph container
│   │   ├── TimelineBar.tsx      # Individual step bar
│   │   └── TimelineRuler.tsx    # Time scale ruler
│   │
│   ├── traces/
│   │   ├── TracesPanel.tsx      # HTTP requests, console, etc.
│   │   ├── NetworkTrace.tsx     # HTTP request/response row
│   │   └── ConsoleTrace.tsx     # Console log entry
│   │
│   └── details/
│       ├── DetailsView.tsx      # Dynamic details renderer
│       ├── StepDetails.tsx      # Selected step information
│       ├── ScreenshotPreview.tsx# Full screenshot view
│       └── NetworkDetails.tsx   # Request/response details
│
├── stores/                      # State management (SolidJS stores)
│   ├── traceStore.ts            # Main trace data store
│   ├── selectionStore.ts        # Current selection/hover state
│   └── uiStore.ts               # UI state (panel sizes, view mode)
│
├── services/                    # Business logic (framework-agnostic)
│   ├── dataLoader/
│   │   ├── index.ts             # Unified loader interface
│   │   ├── zipLoader.ts         # ZIP file extraction
│   │   ├── urlLoader.ts         # Remote URL fetching
│   │   └── types.ts             # Data loader types
│   │
│   ├── traceParser/
│   │   ├── index.ts             # Main parser entry
│   │   ├── otelParser.ts        # OpenTelemetry JSON parsing
│   │   └── screenshotMapper.ts  # Screenshot timestamp mapping
│   │
│   └── serviceWorker/
│       ├── register.ts          # SW registration helper
│       └── sw.ts                # Service worker implementation
│
├── utils/                       # Pure utility functions
│   ├── time.ts                  # Duration formatting, time calculations
│   ├── tree.ts                  # Span tree building utilities
│   └── color.ts                 # Span/step coloring logic
│
├── hooks/                       # SolidJS reactive primitives
│   ├── useTraceData.ts          # Access parsed trace data
│   ├── useSelection.ts          # Selection state management
│   └── useScreenshot.ts         # Screenshot loading with caching
│
├── types/                       # TypeScript type definitions
│   ├── trace.ts                 # Trace data structures
│   ├── screenshot.ts            # Screenshot reference types
│   └── otel.ts                  # OpenTelemetry schema types
│
└── test/
    └── setup.ts                 # Vitest setup

public/
└── sw.js                        # Compiled service worker

tests/
├── fixtures/                    # Test data
│   ├── sample-trace.json
│   ├── screenshot-refs.json
│   └── sample.zip
└── ...                          # Test files co-located with source
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         Data Sources                            │
│  ┌─────────────────┐                  ┌──────────────────────┐  │
│  │  ZIP File       │                  │   Remote URL         │  │
│  │  (drag & drop)  │                  │   (?url=... param)   │  │
│  └────────┬────────┘                  └───────────┬──────────┘  │
│           │                                       │             │
│           ▼                                       ▼             │
│  ┌─────────────────┐                  ┌──────────────────────┐  │
│  │  zipLoader      │                  │   urlLoader          │  │
│  │  + Service      │                  │   (fetch JSON +      │  │
│  │    Worker       │                  │    screenshot URLs)  │  │
│  └────────┬────────┘                  └───────────┬──────────┘  │
│           │                                       │             │
│           └───────────────┬───────────────────────┘             │
│                           ▼                                     │
│              ┌────────────────────────┐                         │
│              │  DataLoader Interface  │                         │
│              │  { trace, refs, base } │                         │
│              └───────────┬────────────┘                         │
└──────────────────────────┼──────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Parsing Layer                               │
│  ┌──────────────────────┐      ┌───────────────────────────┐     │
│  │  otelParser          │      │  screenshotMapper         │     │
│  │  - Parse OTEL JSON   │      │  - Map refs to timestamps │     │
│  │  - Build span tree   │      │  - Resolve URLs           │     │
│  │  - Calculate depths  │      │                           │     │
│  └──────────┬───────────┘      └─────────────┬─────────────┘     │
│             │                                │                   │
│             └──────────────┬─────────────────┘                   │
│                            ▼                                     │
│              ┌────────────────────────┐                          │
│              │     ParsedTrace        │                          │
│              │  (normalized model)    │                          │
│              └───────────┬────────────┘                          │
└──────────────────────────┼───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                 State Layer (SolidJS Stores)                     │
│                                                                  │
│  ┌────────────────┐ ┌──────────────────┐ ┌────────────────────┐  │
│  │  traceStore    │ │  selectionStore  │ │  uiStore           │  │
│  │                │ │                  │ │                    │  │
│  │  - testInfo    │ │  - hoveredSpan   │ │  - panelSizes      │  │
│  │  - spans       │ │  - selectedSpan  │ │  - zoomLevel       │  │
│  │  - screenshots │ │  - hoveredTime   │ │  - viewMode        │  │
│  │  - timeRange   │ │                  │ │                    │  │
│  └────────────────┘ └──────────────────┘ └────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                      UI Components                               │
│                                                                  │
│   Components subscribe to stores via hooks and render            │
│   reactive views. User interactions update stores, which         │
│   automatically propagate changes to all subscribers.            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Data Loading

The application supports two data source modes:

#### 1. ZIP File Loading

Users can drag-and-drop or select a ZIP file containing:
```
trace.zip/
├── trace.json              # OpenTelemetry trace data
├── screenshots.json        # Screenshot reference mapping
└── screenshots/
    ├── screenshot-001.png
    ├── screenshot-002.png
    └── ...
```

A **Service Worker** intercepts fetch requests to serve files from the ZIP:
- ZIP is loaded into memory and parsed using `@zip.js/zip.js`
- Service Worker intercepts requests matching a virtual path pattern
- Screenshots are served on-demand from the ZIP without extracting everything

#### 2. Remote URL Loading

Pass a URL via query parameter: `?url=https://example.com/traces/abc123`

The application will fetch:
- `GET {baseUrl}/otlp-traces` - list OpenTelemetry traces
- `GET {baseUrl}/otlp-traces/pw-reporter-trace.json` - Traces captured by playwright opentelemetry reporter
- `GET {baseUrl}/screenshots` - List screenshots
- `GET {baseUrl}/screenshots/{filename}` - Individual screenshots

### Core Types

```typescript
interface ParsedTrace {
  testInfo: TestInfo;
  rootSpan: Span;
  spans: Map<string, Span>;
  screenshots: Screenshot[];
  timeRange: TimeRange;
}

interface TestInfo {
  name: string;
  file: string;
  duration: number;
  outcome: 'passed' | 'failed' | 'skipped' | 'timedOut';
  startTime: number;
}

interface Span {
  id: string;
  parentId: string | null;
  name: string;
  kind: 'step' | 'action' | 'network' | 'console' | 'other';
  startTime: number;
  endTime: number;
  duration: number;
  attributes: Record<string, unknown>;
  children: Span[];
  depth: number;
}

interface Screenshot {
  id: string;
  timestamp: number;
  url: string;
}

interface TimeRange {
  start: number;
  end: number;
  duration: number;
}
```

## Implementation Phases

### Phase 1: Foundation & Data Layer
- [x] Project setup (TypeScript, SolidJS, Tailwind, Vitest)
- [ ] Type definitions for OTEL and trace data
- [ ] URL data loader implementation
- [ ] ZIP data loader with @zip.js/zip.js
- [ ] Service Worker for ZIP file serving
- [ ] OTEL JSON parser (spans to tree)
- [ ] Screenshot reference mapper
- [ ] Unit tests for all services/utils

### Phase 2: State Management
- [ ] Trace store (holds parsed data)
- [ ] Selection store (hover/selected state)
- [ ] UI store (panel sizes, zoom)
- [ ] Reactive hooks for component access

### Phase 3: Layout & Core UI
- [ ] SplitPane component (resizable)
- [ ] MainPanel / DetailsPanel containers
- [ ] TestHeader component
- [ ] Basic app shell with routing for data source

### Phase 4: Timeline Components
- [ ] Filmstrip component with thumbnails
- [ ] StepsTimeline flame graph
- [ ] TimelineRuler for time scale
- [ ] Zoom and pan interactions

### Phase 5: Details & Traces
- [ ] DetailsView with contextual rendering
- [ ] StepDetails, ScreenshotPreview, NetworkDetails
- [ ] TracesPanel for HTTP/console
- [ ] Selection highlighting across components

### Phase 6: Polish & Performance
- [ ] Virtual scrolling for large traces
- [ ] Keyboard navigation
- [ ] Accessibility improvements
- [ ] Performance optimization

## Development

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Run tests
pnpm test

# Run tests with UI
pnpm test:ui

# Type check
pnpm typecheck

# Build for production
pnpm build
```

## Tech Stack

- **Framework**: SolidJS
- **Styling**: Tailwind CSS v4
- **Build Tool**: Vite
- **Testing**: Vitest
- **ZIP Handling**: @zip.js/zip.js
- **Language**: TypeScript

## Design Principles

1. **Separation of Concerns**: Services are framework-agnostic pure functions, components are thin presentation layers, stores manage state.

2. **Testability**: Business logic in services/utils can be unit tested without UI. Components can be tested with solid-testing-library.

3. **Type Safety**: Full TypeScript with strict mode. Types define contracts between layers.

4. **Performance**: Lazy loading of screenshots, virtual scrolling for large traces, efficient reactive updates via SolidJS fine-grained reactivity.

5. **Modularity**: Each component/service has a single responsibility and can be developed/tested independently.
