# @playwright-opentelemetry/trace-api

H3-based API library for storing and serving Playwright OpenTelemetry traces in S3-compatible object storage.

## Introduction

The Trace API is a customizable library that can be deployed to Cloudflare Workers, Deno, Bun, Node.js, or any platform supporting web-standard Request/Response handlers. It provides endpoints for writing OTLP trace data and Playwright screenshots, and serves them in a format compatible with the trace viewer. Test metadata is stored on the root `playwright.test` span.

Reporter uploads follow Playwright trace retention by default. If Playwright does not produce or retain a trace for a test, no remote trace data is uploaded for that test and viewer read endpoints may return `404`. Configure `use.playwrightOpentelemetry.trace` to override that decision for OpenTelemetry output independently of Playwright's own `use.trace` setting.

## Usage

### Basic Usage

```typescript
import { createTraceApi } from '@playwright-opentelemetry/trace-api';

const api = createTraceApi({
  storageConfig: {
    bucket: 'my-traces',
    endpoint: 'https://xxx.r2.cloudflarestorage.com',
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    region: 'auto',
  },
});

export default {
  fetch: api.fetch,
};
```

### Low-Level Building Blocks with Authentication

For maximum flexibility, compose your own API using individual handlers:

```typescript
import { H3, getHeader, createError } from 'h3';
import {
  createS3Storage,
  createOtlpHandler,
  createPlaywrightHandler,
  createViewerHandler,
  OTLP_TRACES_WRITE_PATH,
  PLAYWRIGHT_REPORTER_WRITE_PATH,
  TRACE_VIEWER_READ_PATH,
} from '@playwright-opentelemetry/trace-api';

const storage = createS3Storage({
  bucket: 'my-traces',
  endpoint: env.R2_ENDPOINT,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
});

const app = new H3();

// Authentication middleware for write endpoints
const authMiddleware = async (event) => {
  const token = getHeader(event, 'authorization')?.replace('Bearer ', '');
  if (!token || !await validateToken(token)) {
    throw createError({ statusCode: 401, message: 'Unauthorized' });
  }
};

// Apply auth to write endpoints
app.use(OTLP_TRACES_WRITE_PATH, authMiddleware);
app.use(PLAYWRIGHT_REPORTER_WRITE_PATH, authMiddleware);

// Add handlers
// /v1/traces/
app.post(OTLP_TRACES_WRITE_PATH, createOtlpHandler({ storage }));
// /playwright-otel-reporter/v1/**
app.put(PLAYWRIGHT_REPORTER_WRITE_PATH, createPlaywrightHandler({ storage }));
// /playwright-otel-trace-viewer/v1/**
app.get(TRACE_VIEWER_READ_PATH, createViewerHandler({ storage }));

export default {
  fetch: app.fetch,
};
```

### Other Runtimes

**Deno:**
```typescript
import { createTraceApi } from '@playwright-opentelemetry/trace-api';

const api = createTraceApi({ storageConfig: { ... } });

Deno.serve({ port: 3000 }, api.fetch);
```

**Bun:**
```typescript
import { createTraceApi } from '@playwright-opentelemetry/trace-api';

const api = createTraceApi({ storageConfig: { ... } });

export default {
  port: 3000,
  fetch: api.fetch,
};
```

**Node.js:**
```typescript
import { serve } from 'h3/node';
import { createTraceApi } from '@playwright-opentelemetry/trace-api';

const api = createTraceApi({ storageConfig: { ... } });

serve(api, { port: 3000 });
```

## API Reference

### Configuration

```typescript
interface TraceApiConfig {
  storage?: TraceStorage;
  storageConfig?: {
    bucket: string;
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    region?: string; // Default: 'auto'
  };
  resolvePath?: (event: H3Event, path: string) => Promise<string> | string;
  corsOrigin?: string | false;
}
```

Provide either `storage` for a custom `TraceStorage` implementation or `storageConfig` to create the built-in S3-compatible storage.

### Endpoints

**Write Endpoints:**

```
POST /v1/traces
Content-Type: application/json
Body: Standard OTLP JSON payload
```

Partitions OTLP spans by trace ID and writes OTLP-shaped fragments to `traces/{traceId}/traces/{requestId}.json`. The fragment filename is a unique request ID, not a service name or span ID.

```
PUT /playwright-otel-reporter/v1/screenshots.zip
X-Trace-Id: {traceId}
Body: ZIP containing manifest.json and screenshots/*
```

Writes the screenshot bundle to `traces/{traceId}/screenshots.zip`.

**Read Endpoints:**

```
GET /playwright-otel-trace-viewer/v1/{traceId}/traces
GET /playwright-otel-trace-viewer/v1/{traceId}/screenshots.zip
```

Serves merged OTLP trace data and the stored screenshot ZIP expected by the trace viewer. The trace endpoint returns `404` when no trace fragments exist. A missing screenshot ZIP returns `404`; the viewer treats that as no screenshots.

## Storage Setup

Configure your S3-compatible bucket with a lifecycle rule to expire traces after the desired retention period.

### AWS S3

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket my-traces \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "ExpireTraces",
      "Status": "Enabled",
      "Filter": { "Prefix": "traces/" },
      "Expiration": { "Days": 30 }
    }]
  }'
```

### Cloudflare R2

```bash
wrangler r2 bucket lifecycle set my-traces --rules '[{
  "id": "expire-traces",
  "enabled": true,
  "conditions": { "prefix": "traces/" },
  "deleteObjectsTransition": { "daysAfterUpload": 30 }
}]'
```

### Storage Structure

```
s3://bucket/
└── traces/
	└── {traceId}/
		├── traces/
		│   └── {requestId}.json
		└── screenshots.zip
```
