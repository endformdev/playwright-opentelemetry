# Trace API Design

Backend API design for storing complete Playwright OpenTelemetry traces in S3-compatible object storage.

## Overview

The Trace API is designed as a **customizable Hono-based library** that can be deployed to Cloudflare Workers (or any other platform supporting Hono). Users import the library and configure it for their specific needs, including custom authentication, multi-tenancy, and storage backends.

## Storage Architecture

Two-directory structure with different lifecycle rules:

```
s3://bucket/
├── pending/           # 1-day expiration lifecycle rule
│   └── {traceId}/
│       ├── opentelemetry-protocol/
│       │   └── {source}.json
│       └── screenshots/
│           └── {filename}.jpeg
│
└── traces/            # Long-term storage
    └── {traceId}/
        ├── test.json
        ├── opentelemetry-protocol/
        │   ├── playwright-opentelemetry.json
        │   └── {source}.json
        └── screenshots/
            └── {pageId}-{timestamp}.jpeg
```

**Why two directories?** OTLP spans from backend services may arrive before the Playwright test completes and sends `test.json`. The `pending/` directory holds these orphan spans temporarily. When `test.json` arrives, all pending data is promoted to `traces/`. If no test.json ever arrives (e.g., a backend service ran but no test was associated), the S3 lifecycle rule automatically cleans up after 1 day.

## Library Architecture

### Installation

```bash
npm install @playwright-opentelemetry/trace-api
```

### Basic Usage (Cloudflare Workers)

```typescript
// worker.ts
import { createTraceApi } from '@playwright-opentelemetry/trace-api';

export default createTraceApi({
  storage: {
    bucket: 'my-traces',
    endpoint: 'https://xxx.r2.cloudflarestorage.com',
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    region: 'auto', // Use 'auto' for R2, or specific region for AWS S3
  },
});
```

### Advanced Usage with Custom Middleware

```typescript
// worker.ts
import { createTraceApi } from '@playwright-opentelemetry/trace-api';
import { cors } from 'hono/cors';

export default createTraceApi({
  storage: {
    bucket: 'my-traces',
    endpoint: 'https://s3.us-east-1.amazonaws.com',
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: 'us-east-1',
  },

  // Transform storage paths (e.g., for multi-tenancy)
  resolvePath: async (ctx, path) => {
    const orgId = ctx.get('orgId');
    return orgId ? `orgs/${orgId}/${path}` : path;
  },

  // Custom middleware by route group
  middleware: {
    // Applied to all routes
    global: [
      cors({ origin: '*' }),
    ],
    // Applied to write endpoints (POST /v1/traces, PUT /playwright-opentelemetry/*)
    write: [
      async (ctx, next) => {
        const token = ctx.req.header('Authorization')?.replace('Bearer ', '');
        const org = await validateToken(token);
        if (!org) {
          return ctx.json({ error: 'Unauthorized' }, 401);
        }
        ctx.set('orgId', org.id);
        await next();
      },
    ],
    // Applied to read endpoints (GET /traces/*)
    read: [
      // Could be different auth, or public
    ],
  },
});
```

### Configuration Options

```typescript
interface TraceApiConfig {
  // S3-compatible storage configuration (required)
  storage: {
    bucket: string;
    endpoint: string;           // S3 endpoint URL
    accessKeyId: string;
    secretAccessKey: string;
    region?: string;            // Default: 'auto' (works for R2)
  };

  // Transform storage paths before read/write (optional)
  // Use this for multi-tenancy, adding org prefixes, etc.
  resolvePath?: (ctx: Context, path: string) => Promise<string> | string;

  // Custom middleware (optional)
  middleware?: {
    global?: MiddlewareHandler[];  // All routes
    write?: MiddlewareHandler[];   // POST/PUT routes
    read?: MiddlewareHandler[];    // GET routes
  };
}
```

### Accessing the Hono App Directly

For advanced use cases, you can access the underlying Hono app:

```typescript
import { createTraceApi } from '@playwright-opentelemetry/trace-api';

const traceApi = createTraceApi({ storage: { ... } });

// Add custom routes
traceApi.get('/health', (c) => c.json({ status: 'ok' }));

// Add additional middleware
traceApi.use('/*', customMiddleware());

export default traceApi;
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
3. HEAD `traces/{traceId}/test.json` to check if trace is promoted
4. If exists: write to `traces/{traceId}/opentelemetry-protocol/{serviceName}.json`
5. If not: write to `pending/{traceId}/opentelemetry-protocol/{serviceName}.json`

Any OTLP-compatible instrumentation can send spans here (OpenTelemetry SDKs, custom instrumentation, etc.).

### Playwright-Specific Endpoints

```
PUT /playwright-opentelemetry/test.json
X-Trace-Id: {traceId}

Body: test.json content
```

**Backend logic:**
1. Write to `traces/{traceId}/test.json`
2. LIST `pending/{traceId}/`
3. For each object: COPY to `traces/{traceId}/...` then DELETE from pending

```
PUT /playwright-opentelemetry/screenshots/{filename}
X-Trace-Id: {traceId}

Body: JPEG image data
```

**Backend logic:**
1. HEAD `traces/{traceId}/test.json`
2. If exists: write to `traces/{traceId}/screenshots/{filename}`
3. If not: write to `pending/{traceId}/screenshots/{filename}`

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

Users must configure their S3-compatible bucket with a lifecycle rule to expire objects in the `pending/` prefix. This is a one-time setup.

### AWS S3

Using AWS CLI:
```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket my-traces \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "ExpirePendingTraces",
      "Status": "Enabled",
      "Filter": { "Prefix": "pending/" },
      "Expiration": { "Days": 1 }
    }]
  }'
```

Or via AWS Console:
1. Go to S3 > your bucket > Management > Lifecycle rules
2. Create rule with prefix filter `pending/`
3. Set expiration to 1 day

### Cloudflare R2

Using Wrangler:
```bash
wrangler r2 bucket lifecycle set my-traces --rules '[{
  "id": "expire-pending",
  "enabled": true,
  "conditions": { "prefix": "pending/" },
  "deleteObjectsTransition": { "daysAfterUpload": 1 }
}]'
```

Or via Cloudflare Dashboard:
1. Go to R2 > your bucket > Settings > Object lifecycle rules
2. Add rule with prefix `pending/`
3. Set "Delete objects" after 1 day

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
│   ├── createTraceApi.ts     # Factory function
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

- **Pending traces**: S3 lifecycle rule expires objects in `pending/` after 1 day
- **Promoted traces**: Objects in `traces/` persist until explicitly deleted or per your retention policy

This ensures orphan spans (from services that ran but had no associated test) are automatically cleaned up without any application-level garbage collection logic.

## Cost Characteristics

Per-request costs (S3 Standard pricing, R2 is similar):
- HEAD (existence check): $0.0004/1,000 requests, ~10-50ms latency
- PUT: $0.005/1,000 requests
- GET: $0.0004/1,000 requests
- LIST: $0.005/1,000 requests
- Storage: $0.023/GB/month (S3), $0.015/GB/month (R2)

The HEAD check on every OTLP request adds ~10-50ms latency. For high-throughput scenarios, consider:
- Caching known traceIds in Workers KV or Durable Objects
- Using R2 for lower latency from Workers

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
import { cors } from 'hono/cors';

interface Env {
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ENDPOINT: string;
  // Your auth service binding
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

      resolvePath: (ctx, path) => {
        const orgId = ctx.get('orgId');
        // Prefix all paths with org ID for isolation
        return `orgs/${orgId}/${path}`;
      },

      middleware: {
        global: [cors({ origin: '*' })],
        write: [
          async (ctx, next) => {
            const token = ctx.req.header('Authorization')?.replace('Bearer ', '');
            if (!token) {
              return ctx.json({ error: 'Missing authorization' }, 401);
            }

            // Validate token and get org
            const response = await env.AUTH_SERVICE.fetch(
              'https://auth/validate',
              { headers: { Authorization: `Bearer ${token}` } }
            );

            if (!response.ok) {
              return ctx.json({ error: 'Invalid token' }, 401);
            }

            const { orgId } = await response.json();
            ctx.set('orgId', orgId);
            await next();
          },
        ],
        read: [
          async (ctx, next) => {
            // Similar auth for read access
            // Or make traces publicly readable by trace ID
            await next();
          },
        ],
      },
    });

    return api.fetch(request);
  },
};
```

This results in storage paths like:
```
traces/orgs/{orgId}/traces/{traceId}/test.json
traces/orgs/{orgId}/pending/{traceId}/opentelemetry-protocol/...
```
