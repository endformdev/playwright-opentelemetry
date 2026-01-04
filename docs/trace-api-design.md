# Trace API Design

Backend API design for storing complete Playwright OpenTelemetry traces in S3-compatible object storage.

## Overview

The Trace API is designed as a **customizable H3-based library** that can be deployed to Cloudflare Workers, Deno, Bun, Node.js, or any other platform supporting web-standard Request/Response handlers. Users import the library and configure it for their specific needs, including custom authentication, multi-tenancy, and storage backends.

## Storage Architecture

Single directory structure with lifecycle-based retention:

```
s3://bucket/
└── traces/
    └── {traceId}/
        ├── test.json
        ├── opentelemetry-protocol/
        │   ├── playwright-opentelemetry.json
        │   └── {source}.json
        └── screenshots/
            └── {pageId}-{timestamp}.jpeg
```

All data writes directly to `traces/{traceId}/`. A lifecycle rule expires traces after a configurable retention period (default: 30 days).

**Orphan spans** (OTLP data from services where no test.json ever arrives) will accumulate until the lifecycle rule cleans them up. This is an acceptable trade-off for the simplicity of not needing existence checks, conditional routing, or promotion logic.

## Library Architecture

### Installation

```bash
npm install @playwright-opentelemetry/trace-api
```

### Basic Usage (Cloudflare Workers)

```typescript
// worker.ts
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

### Advanced Usage with Custom Middleware

```typescript
// worker.ts
import { createTraceApi } from '@playwright-opentelemetry/trace-api';

const api = createTraceApi({
  storage: {
    bucket: 'my-traces',
    endpoint: 'https://s3.us-east-1.amazonaws.com',
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: 'us-east-1',
  },

  // Transform storage paths (e.g., for multi-tenancy)
  resolvePath: async (event, path) => {
    const orgId = event.context.orgId;
    return orgId ? `orgs/${orgId}/${path}` : path;
  },

  // Global middleware (runs on all requests)
  middleware: [
    (event) => {
      console.log(`[${event.req.method}] ${event.path}`);
    },
  ],

  // Write middleware (runs on POST/PUT endpoints)
  writeMiddleware: [
    async (event) => {
      const token = getHeader(event, 'authorization')?.replace('Bearer ', '');
      const org = await validateToken(token);
      if (!org) {
        throw createError({ statusCode: 401, message: 'Unauthorized' });
      }
      event.context.orgId = org.id;
    },
  ],

  // Read middleware (runs on GET endpoints)
  readMiddleware: [
    // Could be different auth, or public
  ],
});

export default {
  fetch: api.fetch,
};
```

### Configuration Options

```typescript
interface TraceApiConfig {
  // S3-compatible storage configuration (required)
  storage: {
    bucket: string;
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    region?: string; // Default: 'auto' (works for R2)
  };

  // Transform storage paths before read/write (optional)
  resolvePath?: (event: H3Event, path: string) => Promise<string> | string;

  // Middleware arrays (optional)
  middleware?: EventHandler[];      // All routes
  writeMiddleware?: EventHandler[]; // POST/PUT routes
  readMiddleware?: EventHandler[];  // GET routes
}
```

### Accessing the H3 App Directly

For advanced use cases, you can access the underlying H3 instance:

```typescript
import { createTraceApi } from '@playwright-opentelemetry/trace-api';

const api = createTraceApi({ storage: { ... } });

// Add custom routes
api.get('/health', () => ({ status: 'ok' }));

// Add additional middleware
api.use((event) => {
  // custom logic
});

// Mount sub-applications
api.mount('/admin', adminApp);

export default {
  fetch: api.fetch,
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

## API Endpoints

### Standard OTLP Endpoint

```
POST /v1/traces
Content-Type: application/json

Body: Standard OTLP JSON payload
```

**Backend logic:**
1. Parse `traceId` from each span in the payload
2. Extract `service.name` from resource attributes for the filename
3. Write to `traces/{traceId}/opentelemetry-protocol/{serviceName}.json`

Any OTLP-compatible instrumentation can send spans here (OpenTelemetry SDKs, custom instrumentation, etc.).

### Playwright-Specific Endpoints

```
PUT /playwright-opentelemetry/test.json
X-Trace-Id: {traceId}

Body: test.json content
```

**Backend logic:**
1. Write to `traces/{traceId}/test.json`

```
PUT /playwright-opentelemetry/screenshots/{filename}
X-Trace-Id: {traceId}

Body: JPEG image data
```

**Backend logic:**
1. Write to `traces/{traceId}/screenshots/{filename}`

### Trace Viewer API (Read)

Serves the format expected by the trace viewer:

```
GET /traces/{traceId}/test.json
GET /traces/{traceId}/opentelemetry-protocol
  -> { "jsonFiles": ["playwright-opentelemetry.json", "backend.json"] }
GET /traces/{traceId}/opentelemetry-protocol/{file}.json
GET /traces/{traceId}/screenshots
  -> { "screenshots": [{ "timestamp": 1234567890, "file": "page@abc-1234567890.jpeg" }] }
GET /traces/{traceId}/screenshots/{filename}
```

The listing endpoints (`/opentelemetry-protocol` and `/screenshots`) call S3 ListObjects and format the response.

## Bucket Setup (Required)

Users must configure their S3-compatible bucket with a lifecycle rule to expire traces after the desired retention period. This is a one-time setup.

### AWS S3

Using AWS CLI:
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

Or via AWS Console:
1. Go to S3 > your bucket > Management > Lifecycle rules
2. Create rule with prefix filter `traces/`
3. Set expiration to desired retention period (e.g., 30 days)

### Cloudflare R2

Using Wrangler:
```bash
wrangler r2 bucket lifecycle set my-traces --rules '[{
  "id": "expire-traces",
  "enabled": true,
  "conditions": { "prefix": "traces/" },
  "deleteObjectsTransition": { "daysAfterUpload": 30 }
}]'
```

Or via Cloudflare Dashboard:
1. Go to R2 > your bucket > Settings > Object lifecycle rules
2. Add rule with prefix `traces/`
3. Set "Delete objects" after desired retention period

### Other S3-Compatible Storage

Most S3-compatible storage providers (MinIO, Backblaze B2, etc.) support lifecycle policies. Consult your provider's documentation for the specific configuration method.

## Implementation Details

### S3 Client

The library uses [aws4fetch](https://github.com/mhart/aws4fetch) for S3 operations. This is a lightweight (~3KB) library that handles AWS Signature V4 signing and works with any S3-compatible storage including AWS S3, Cloudflare R2, MinIO, and others.

### Package Structure

```
trace-api/
├── src/
│   ├── index.ts              # Main exports
│   ├── createTraceApi.ts     # Factory function returning H3 instance
│   ├── routes/
│   │   ├── otlp.ts           # POST /v1/traces
│   │   ├── playwright.ts     # PUT /playwright-opentelemetry/*
│   │   └── viewer.ts         # GET /traces/*
│   ├── storage/
│   │   ├── types.ts          # Storage interface
│   │   └── s3.ts             # S3 implementation using aws4fetch
│   └── utils/
│       └── otlp.ts           # OTLP parsing helpers
├── package.json
├── tsconfig.json
└── README.md
```

## Lifecycle and Garbage Collection

- **All traces**: S3 lifecycle rule expires objects in `traces/` after the configured retention period (recommended: 30 days)
- **Orphan spans**: Traces without `test.json` are cleaned up by the same lifecycle rule

This approach accepts that some orphan data may exist temporarily, trading perfect cleanup for operational simplicity.

## Cost Characteristics

Per-request costs (S3 Standard pricing, R2 is similar):
- PUT: $0.005/1,000 requests
- GET: $0.0004/1,000 requests
- LIST: $0.005/1,000 requests
- Storage: $0.023/GB/month (S3), $0.015/GB/month (R2)

The simplified architecture eliminates HEAD checks entirely, reducing both latency and cost per request.

## Adding External Traces

Any service can contribute spans to a trace by sending OTLP data with matching `traceId`:

```json
{
  "resourceSpans": [{
    "resource": {
      "attributes": [
        { "key": "service.name", "value": { "stringValue": "backend-api" } }
      ]
    },
    "scopeSpans": [{
      "scope": { "name": "my-instrumentation" },
      "spans": [{
        "traceId": "7709187832dca84f02f413a312421586",
        "spanId": "abc123",
        "parentSpanId": "def456",
        "name": "HTTP GET /api/users",
        "startTimeUnixNano": "1766927492260000000",
        "endTimeUnixNano": "1766927492300000000",
        "status": { "code": 1 }
      }]
    }]
  }]
}
```

The `traceId` is propagated via the `traceparent` HTTP header by the Playwright fixture, so backend services using OpenTelemetry will automatically correlate their spans with the test trace.

## Multi-Tenancy Example

Here's a complete example of a multi-tenant setup where each organization's traces are isolated:

```typescript
// worker.ts
import { createTraceApi } from '@playwright-opentelemetry/trace-api';
import { getHeader, createError } from 'h3';

interface Env {
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ENDPOINT: string;
  AUTH_SERVICE: Fetcher;
}

export default {
  fetch: (request: Request, env: Env) => {
    const api = createTraceApi({
      storage: {
        bucket: 'traces',
        endpoint: env.R2_ENDPOINT,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        region: 'auto',
      },

      resolvePath: (event, path) => {
        const orgId = event.context.orgId;
        return `orgs/${orgId}/${path}`;
      },

      writeMiddleware: [
        async (event) => {
          const token = getHeader(event, 'authorization')?.replace('Bearer ', '');
          if (!token) {
            throw createError({ statusCode: 401, message: 'Missing authorization' });
          }

          const response = await env.AUTH_SERVICE.fetch(
            'https://auth/validate',
            { headers: { Authorization: `Bearer ${token}` } }
          );

          if (!response.ok) {
            throw createError({ statusCode: 401, message: 'Invalid token' });
          }

          const { orgId } = await response.json();
          event.context.orgId = orgId;
        },
      ],

      readMiddleware: [
        async (event) => {
          // Similar auth for read access, or make traces publicly readable
        },
      ],
    });

    return api.fetch(request);
  },
};
```

This results in storage paths like:
```
traces/orgs/{orgId}/traces/{traceId}/test.json
traces/orgs/{orgId}/traces/{traceId}/opentelemetry-protocol/...
```
