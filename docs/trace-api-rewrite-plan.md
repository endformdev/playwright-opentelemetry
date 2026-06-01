# Trace API Rewrite Plan

## Goal

Rewrite the trace viewer read API so OpenTelemetry trace data is loaded by trace ID as a first-class OTLP payload, not as a list of internal JSON files.

The target read API is:

```text
GET /playwright-otel-trace-viewer/{traceId}/traces
GET /playwright-otel-trace-viewer/{traceId}/screenshots
GET /playwright-otel-trace-viewer/{traceId}/screenshots/{filename}
```

The traces endpoint returns a single OTLP-shaped trace export response:

```json
{
	"resourceSpans": []
}
```

Screenshots remain a project-specific companion API and continue to work like they do today: the list endpoint returns timestamped screenshot filenames, and individual screenshot URLs return binary image data.

There is no backwards compatibility requirement. Remove the old read API shape entirely:

```text
GET /playwright-otel-trace-viewer/{traceId}/opentelemetry-protocol
GET /playwright-otel-trace-viewer/{traceId}/opentelemetry-protocol/{file}.json
GET /playwright-otel-trace-viewer/{traceId}/test.json
```

Non-existent trace IDs must return `404` from `GET /playwright-otel-trace-viewer/{traceId}/traces`; they must not return `{ "resourceSpans": [] }`.

## Guiding Principles

1. Keep OTLP ingest standard: `POST /v1/traces` accepts OTLP JSON export requests.
2. Make `traceId` the primary read identity.
3. Keep stored trace fragments trace-scoped so reads are efficient on S3/R2-style object storage.
4. Do not expose internal object layout to the viewer.
5. Preserve OTLP shape whenever possible: read responses should be `{ resourceSpans: [...] }`.
6. Derive test metadata from the root `playwright.test` span rather than persisting `test.json`.
7. Keep screenshots outside OTLP because they are not OpenTelemetry data.

## Internal Storage Model

### Existing Problem

The current storage/read model exposes internal chunks through `/opentelemetry-protocol`:

```text
traces/{traceId}/traces/{serviceName}-{spanId}.json
```

The viewer first lists these files and then fetches every file. That leaks storage layout into the public API and causes double loading when the viewer also needs OTLP data to derive test metadata.

### New Storage Layout

Store trace fragments under a trace-scoped `traces/` directory:

```text
traces/{traceId}/traces/{requestId}.json
traces/{traceId}/screenshots/{filename}
```

Each trace fragment remains an OTLP-shaped JSON object:

```json
{
	"resourceSpans": []
}
```

`requestId` should be unique per persisted fragment. It should not encode service names or span IDs. Use a simple unique value such as:

```text
{Date.now()}-{crypto.randomUUID()}.json
```

or another runtime-safe random identifier.

### Why Partition By Trace ID

OTLP export requests may contain spans from multiple traces. Storing the raw incoming payload unchanged under a single trace ID is incorrect because spans for other trace IDs become undiscoverable or misplaced.

Instead, ingest should:

1. Receive one OTLP export request.
2. Discover every trace ID present in the request.
3. For each trace ID, create a filtered OTLP export request containing only spans for that trace ID.
4. Store one trace-scoped fragment per trace ID.

This keeps storage lookup efficient while staying close to the incoming OTLP structure.

## OTLP Partitioning Algorithm

Input:

```ts
interface OtlpExport {
	resourceSpans?: ResourceSpans[];
}
```

Output:

```ts
Map<traceId, OtlpExport>
```

Algorithm:

1. Iterate `payload.resourceSpans ?? []`.
2. For each `resourceSpan`, iterate `resourceSpan.scopeSpans ?? []`.
3. For each `scopeSpan`, group `scopeSpan.spans ?? []` by `span.traceId`.
4. Ignore spans without a valid trace ID.
5. For each trace ID group, create a filtered `scopeSpan` with only those spans.
6. Preserve the original `resource` object on the filtered `resourceSpan`.
7. Preserve the original `scope` and other scope-level fields on the filtered `scopeSpan`.
8. Drop empty scope spans and empty resource spans.
9. Append the filtered resource span to that trace ID's output export.

The partitioner should not merge resources or scopes. Concatenating `resourceSpans` is valid OTLP and is simpler than deep merging.

Pseudo-code:

```ts
function partitionOtlpExportByTraceId(payload: OtlpExport): Map<string, OtlpExport> {
	const traces = new Map<string, OtlpExport>();

	for (const resourceSpan of payload.resourceSpans ?? []) {
		for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
			const spansByTraceId = groupBy(scopeSpan.spans ?? [], (span) => span.traceId);

			for (const [traceId, spans] of spansByTraceId) {
				if (!traceId) continue;

				const filteredResourceSpan = {
					...resourceSpan,
					scopeSpans: [
						{
							...scopeSpan,
							spans,
						},
					],
				};

				const traceExport = traces.get(traceId) ?? { resourceSpans: [] };
				traceExport.resourceSpans.push(filteredResourceSpan);
				traces.set(traceId, traceExport);
			}
		}
	}

	return traces;
}
```

## Server Rewrite

### API Constants

Keep the existing broad handler constants unless stricter paths are useful:

```ts
export const OTLP_TRACES_WRITE_PATH = "/v1/traces";
export const PLAYWRIGHT_REPORTER_WRITE_PATH = "/playwright-otel-reporter/**";
export const TRACE_VIEWER_READ_PATH = "/playwright-otel-trace-viewer/**";
```

The handler implementation, not the constant, should reject unsupported read paths.

### OTLP Ingest Handler

Rewrite `createOtlpHandler` so it no longer stores one file per service/span group.

New behavior:

1. Read the OTLP request body.
2. Partition the payload by trace ID using the partitioning algorithm above.
3. For each `[traceId, traceExport]`, write one object:

```text
traces/{traceId}/traces/{requestId}.json
```

4. Apply `resolvePath(event, path)` before writing, as today.
5. Store as `application/json`.
6. Return `{ status: "ok" }`.

If the payload contains no valid trace IDs, return success and store nothing. This is consistent with OTLP's tolerance for empty telemetry envelopes.

### Viewer Read Handler

Rewrite `createViewerHandler` to support only the new API.

#### `GET /playwright-otel-trace-viewer/{traceId}/traces`

Implementation:

1. Build prefix:

```text
traces/{traceId}/traces/
```

2. Apply `resolvePath(event, prefix)` if configured.
3. `storage.list(resolvedPrefix)`.
4. Filter to `.json` files.
5. If no files exist, throw 404.
6. Load all files with `storage.get(file)`.
7. Decode and parse each JSON object.
8. Return:

```json
{
	"resourceSpans": [
		"all resource spans from all fragments"
	]
}
```

The merge operation is only:

```ts
const resourceSpans = payloads.flatMap((payload) => payload.resourceSpans ?? []);
```

If any listed object cannot be loaded, parsed, or decoded, fail the request. Do not silently drop trace fragments.

#### `GET /playwright-otel-trace-viewer/{traceId}/screenshots`

Keep current behavior:

1. List `traces/{traceId}/screenshots/`.
2. Return sorted screenshot metadata:

```json
{
	"screenshots": [
		{ "timestamp": 1767539662401, "file": "page@abc-1767539662401.jpeg" }
	]
}
```

If there are no screenshots, return `{ "screenshots": [] }`. This endpoint should not 404 just because a trace has no screenshots.

#### `GET /playwright-otel-trace-viewer/{traceId}/screenshots/{filename}`

Keep current behavior:

1. Load `traces/{traceId}/screenshots/{filename}`.
2. Return 404 if missing.
3. Return binary image response if present.

#### Unsupported Read Paths

All other read paths should return 404, including:

```text
/playwright-otel-trace-viewer/{traceId}
/playwright-otel-trace-viewer/{traceId}/opentelemetry-protocol
/playwright-otel-trace-viewer/{traceId}/opentelemetry-protocol/{file}.json
/playwright-otel-trace-viewer/{traceId}/test.json
```

### Storage Interface

No storage interface change is required.

The existing interface is enough:

```ts
interface TraceStorage {
	put(path: string, data: string | ArrayBuffer, contentType: string): Promise<void>;
	get(path: string): Promise<ArrayBuffer | null>;
	list(prefix: string): Promise<string[]>;
}
```

Future improvement: add paginated listing support for S3/R2. Current `list` only handles a single ListObjectsV2 page, which is acceptable for the rewrite but not fully robust for traces with more than 1000 stored objects.

## Viewer Rewrite

### TraceInfo Shape

Replace URL-based trace data with first-class OTLP data.

Target shape:

```ts
interface TraceInfo {
	testInfo: TestInfo;
	traceData: OtlpExport;
	screenshots: ScreenshotInfo[];
}
```

Remove:

```ts
traceData: OtlpExport;
```

### Remote API Loader

`loadRemoteApi(baseUrl)` should:

1. Normalize `baseUrl`.
2. Fetch `${baseUrl}/traces`.
3. If the response is 404, surface a trace-not-found error.
4. Parse and validate the returned OTLP export payload.
5. Derive `testInfo` from the root `playwright.test` span.
6. Fetch `${baseUrl}/screenshots`.
7. Convert screenshot list entries to URLs:

```ts
{
	timestamp: screenshot.timestamp,
	url: `${baseUrl}/screenshots/${screenshot.file}`,
}
```

8. Return `{ testInfo, traceData, screenshots }`.

It should not fetch any individual OTLP JSON files.

### Trace Data Loader

Rewrite `useTraceDataLoader` to consume `traceInfo.traceData` directly.

The flow becomes:

```text
TraceInfo.traceData
-> otlpExportToSpans(traceData, testStartTimeMs)
-> categorizeSpans(spans)
-> render
```

The current `loadedUrls` / `totalUrls` progress model can be removed or replaced with a simpler `status` only. If we still want progress in the future, it should be based on parsing/conversion stages, not remote file URLs.

### Shared OTLP Parsing

Extract validation into a reusable helper:

```ts
parseOtlpExport(json: unknown): OtlpExport
```

Use it for:

1. Remote API responses.
2. ZIP OTLP files.
3. Any tests/builders that parse OTLP fixtures.

Do not cast `unknown as OtlpExport` in loaders.

### Test Metadata Derivation

Keep or introduce:

```ts
deriveTestInfoFromOtlpExport(traceData: OtlpExport): TestInfo
```

It should find the root `playwright.test` span and derive:

```text
test.case.title
playwright.test.describes
playwright.test.status
code.file.path
code.line.number
traceId
startTimeUnixNano
endTimeUnixNano
```

If no `playwright.test` span exists, the viewer should fail with a clear error. Backend-only traces may exist in storage, but this viewer is for Playwright test traces and needs a root test span.

### Attribute Values

Unify OTLP attribute extraction.

Preferred internal type:

```ts
type SpanAttributeValue = string | number | boolean | string[];
```

Support OTLP `arrayValue` for string arrays so `playwright.test.describes` can be represented consistently. Update formatting and search to display arrays deterministically, for example by joining with `, `.

## ZIP Rewrite

ZIP loading should produce the same `TraceInfo` shape as remote API loading.

### ZIP Layout

Update generated ZIPs to use:

```text
traces/
	playwright-opentelemetry.json
screenshots/
	{pageId}-{timestamp}.jpeg
```

If simpler during implementation, local ZIP parsing may temporarily accept the old `traces/` directory, but the final rewritten format should be `traces/`.

### ZIP Loader

`parseZipEntries` should:

1. Read every `.json` file under `traces/`.
2. Parse and validate each file as OTLP.
3. Merge them into one `OtlpExport` by concatenating `resourceSpans`.
4. Derive `testInfo` from the merged export.
5. Read screenshots and produce screenshot metadata.
6. Return the same `TraceInfo` data shape as remote loading.

### Service Worker

Remove OTLP trace JSON from service worker state and fetch handling.

Two options for screenshots:

1. Minimal: keep service worker only for local ZIP screenshots.
2. Cleaner: replace service-worker screenshot serving with `URL.createObjectURL` and remove the service worker entirely.

The minimal option is lower risk. The cleaner option is likely better long-term.

## Reporter Changes

### OTLP Sending

Keep reporter OTLP sending unchanged at the API boundary:

```text
POST /v1/traces
```

The server's ingest handler handles trace-ID partitioning.

### Screenshot Uploads

Keep screenshot upload endpoint:

```text
PUT /playwright-otel-reporter/screenshots/{filename}
X-Trace-Id: {traceId}
```

Internal storage remains:

```text
traces/{traceId}/screenshots/{filename}
```

### Root Test Span Metadata

Ensure the root `playwright.test` span contains all viewer-required metadata because `test.json` is gone:

```text
test.case.title
playwright.test.describes
playwright.test.status
code.file.path
code.line.number
```

## Test Plan

### Trace API Unit Tests

Rewrite tests to assert the new API only.

Required coverage:

1. `POST /v1/traces` stores a single-trace payload under `traces/{traceId}/traces/`.
2. `GET /playwright-otel-trace-viewer/{traceId}/traces` returns merged `{ resourceSpans }`.
3. Multiple OTLP posts for the same trace ID are merged in the traces response.
4. One OTLP post containing multiple trace IDs is partitioned into separate trace-scoped stored fragments.
5. Fetching trace A does not include spans from trace B.
6. Multi-resource/multi-scope OTLP payloads preserve resource and scope structure after partitioning.
7. Non-existent trace ID returns 404 from `/traces`.
8. Corrupt stored JSON causes `/traces` to fail clearly.
9. Old `/opentelemetry-protocol` endpoints return 404.
10. Old `/test.json` endpoint returns 404.

### Screenshot API Tests

Required coverage:

1. Screenshot upload still writes under trace ID.
2. `GET /screenshots` lists screenshots sorted by timestamp.
3. `GET /screenshots` returns an empty list when no screenshots exist.
4. `GET /screenshots/{filename}` returns image bytes.
5. Missing screenshot returns 404.
6. Multi-tenant `resolvePath` still isolates screenshots.

### Viewer Tests

Required coverage:

1. Remote API loader fetches `/traces` once.
2. Remote API loader fetches `/screenshots` once.
3. Remote API loader does not fetch `/opentelemetry-protocol`.
4. Test header metadata is derived from the root `playwright.test` span.
5. Trace spans render from the same parsed OTLP payload used for metadata.
6. 404 from `/traces` displays a trace-not-found error.

### ZIP Tests

Required coverage:

1. Generated ZIP uses `traces/` and `screenshots/` directories.
2. ZIP loader reads OTLP from `traces/`.
3. ZIP loader merges multiple trace JSON files into one `OtlpExport`.
4. ZIP loader derives `testInfo` from the merged OTLP payload.
5. ZIP loader no longer routes OTLP JSON through the service worker.
6. ZIP screenshots still render.

### Reporter Tests

Required coverage:

1. Reporter does not send `test.json`.
2. Reporter sends root `playwright.test` span with required metadata.
3. Reporter sends screenshots with `X-Trace-Id`.
4. Reporter still supports sending both to a normal OTLP endpoint and this trace API endpoint.

## Implementation Order

1. Add shared OTLP types/helpers for parsing, merging, and trace-ID partitioning.
2. Rewrite `createOtlpHandler` to partition by trace ID and store under `traces/{traceId}/traces/{requestId}.json`.
3. Rewrite `createViewerHandler` to expose only `/traces` and `/screenshots` endpoints.
4. Update trace API tests to the new read shape and storage semantics.
5. Update remote viewer loader to fetch `/traces` once and carry parsed OTLP data forward.
6. Update `TraceInfo` and `useTraceDataLoader` to remove URL-based OTLP loading.
7. Update ZIP writer and ZIP loader to use `traces/` and produce the same in-memory shape.
8. Remove OTLP trace serving from the service worker, or remove the service worker entirely if replacing screenshot URLs with object URLs.
9. Update reporter tests and e2e tests.
10. Update README and `docs/trace-api-design.md` to describe the new API only.

## Acceptance Criteria

1. No code path fetches `/opentelemetry-protocol` in the viewer.
2. Remote viewer load performs one OTLP fetch: `GET /playwright-otel-trace-viewer/{traceId}/traces`.
3. `GET /playwright-otel-trace-viewer/{traceId}/traces` returns a valid OTLP-shaped `{ resourceSpans }` payload.
4. Ingest partitions mixed-trace OTLP requests by trace ID before storing.
5. Reads for trace A never include spans from trace B.
6. Non-existent trace IDs return 404 from `/traces`.
7. Screenshots continue to list and load through `/screenshots` endpoints.
8. `test.json` is fully removed from reporter, trace API, viewer, tests, and docs.
9. `pnpm tsc` and `pnpm test` pass from the workspace root.
