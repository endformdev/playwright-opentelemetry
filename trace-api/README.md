# @playwright-opentelemetry/trace-api

H3-based API library for storing and serving Playwright OpenTelemetry traces in S3-compatible object storage.

## Introduction

The Trace API is a customizable library that can be deployed to Cloudflare Workers, Deno, Bun, Node.js, or any platform supporting web-standard Request/Response handlers. It provides endpoints for writing OTLP trace data and Playwright test artifacts, and serves them in a format compatible with the trace viewer.

## Usage

### Basic Usage

```typescript
import { createTraceApi } from '@playwright-opentelemetry/trace-api';

const api = createTraceApi({
  storage: {
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
  PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH,
  TRACES_READ_PATH,
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
app.use(PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH, authMiddleware);

// Add handlers
// /v1/traces/
app.post(OTLP_TRACES_WRITE_PATH, createOtlpHandler(storage));
// /playwright-opentelemetry/**
app.put(PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH, createPlaywrightHandler(storage));
// /traces/**
app.get(TRACES_READ_PATH, createViewerHandler(storage));

export default {
  fetch: app.fetch,
};
```

### Other Runtimes

**Deno:**
```typescript
import { createTraceApi } from '@playwright-opentelemetry/trace-api';

const api = createTraceApi({ storage: { ... } });

Deno.serve({ port: 3000 }, api.fetch);
```

**Bun:**
```typescript
import { createTraceApi } from '@playwright-opentelemetry/trace-api';

const api = createTraceApi({ storage: { ... } });

export default {
  port: 3000,
  fetch: api.fetch,
};
```

**Node.js:**
```typescript
import { serve } from 'h3/node';
import { createTraceApi } from '@playwright-opentelemetry/trace-api';

const api = createTraceApi({ storage: { ... } });

serve(api, { port: 3000 });
```

## API Reference

### Configuration

```typescript
interface TraceApiConfig {
  storage: {
    bucket: string;
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    region?: string; // Default: 'auto'
  };
}
```

### Endpoints

**Write Endpoints:**

```
POST /v1/traces
Content-Type: application/json
Body: Standard OTLP JSON payload
```

Writes OTLP spans to `traces/{traceId}/opentelemetry-protocol/{serviceName}.json`.

```
PUT /playwright-opentelemetry/test.json
X-Trace-Id: {traceId}
Body: test.json content
```

Writes test metadata to `traces/{traceId}/test.json`.

```
PUT /playwright-opentelemetry/screenshots/{filename}
X-Trace-Id: {traceId}
Body: JPEG image data
```

Writes screenshots to `traces/{traceId}/screenshots/{filename}`.

**Read Endpoints:**

```
GET /traces/{traceId}/test.json
GET /traces/{traceId}/opentelemetry-protocol
GET /traces/{traceId}/opentelemetry-protocol/{file}.json
GET /traces/{traceId}/screenshots
GET /traces/{traceId}/screenshots/{filename}
```

Serves trace data in the format expected by the trace viewer.

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
        ├── test.json
        ├── opentelemetry-protocol/
        │   ├── playwright-opentelemetry.json
        │   └── {serviceName}.json
        └── screenshots/
            └── {pageId}-{timestamp}.jpeg
```
