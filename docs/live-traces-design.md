# Live Traces Design

Status: **Draft / direction-setting.** This document records the direction we're exploring for viewing traces while a test is still running, the decisions taken so far, and the questions that are still open. Nothing here is implemented yet.

## Goal

Let someone open a trace viewer URL while a test is running and see:

1. everything that has been recorded so far, and then
2. new spans and screenshots as they arrive, pushed to the browser rather than polled by it.

The motivating case is an agent driving a live, interactive test session (for example Endform's live test sessions). We want to hand out a URL that shows what the agent is exploring as it happens. Live sessions are short-lived: their traces only need to exist for about a day.

## Where we are today

Every layer assumes a trace is complete before anyone reads it.

| Layer       | Current behaviour                                                                                                                                                                                                                                                                | Why it blocks live viewing                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Reporter    | `onTestBegin` and `onStepBegin` are empty. All test and step spans are built in `onTestEnd` and exported once, in `onEnd`.                                                                                                                                                       | Nothing reaches storage until the run ends.                 |
| Fixture     | Browser and network spans are collected in memory and sent in one POST at fixture teardown.                                                                                                                                                                                      | Nothing reaches storage until the test ends.                |
| Screenshots | Pulled out of Playwright's `trace.zip` after the test and uploaded as one `screenshots.zip`.                                                                                                                                                                                     | Only one upload per trace, at the very end.                 |
| Trace API   | Append-only fragments (`traces/{traceId}/traces/{Date.now()}-{uuid}.json`) in object storage, merged on read. No cursor, ordering or lifecycle state. `screenshots.zip` is served with `Cache-Control: public, max-age=600`.                                                     | No way to ask "what's new since X", and no way to be told.  |
| Viewer      | Fetches `traces` and `screenshots.zip` once. `deriveTestInfoFromOtlpExport` throws if there is no `playwright.test` span. The time axis is fixed to the root span, and the viewport resets when the duration changes. The service worker caches each screenshot ZIP permanently. | Can't render a trace without its root span, and can't grow. |

## Decisions so far

### 1. Live traces are a separate, short-lived kind of trace

Live traces are not a streaming mode bolted onto today's traces. They are their own kind, with their own store and a short default retention (about a day).

- **Static traces don't change.** Normal CI runs keep today's path: R2/S3 fragments, `screenshots.zip`, a 30-day lifecycle rule.
- **The retention conflict disappears.** Modes such as `retain-on-failure` only matter for static traces, and a live trace is always retained until it expires.
- **Short retention is what makes a Durable Object a good fit (decision 4).** There's no need for long-term storage, compaction or archival.

### 2. Export completed spans only, with no open or partial spans

We will not export a span when it starts and again when it ends. Spans are exported once, when they finish, which is what the reporter (`onStepEnd`, `onTestEnd`) and fixture (request finished, page closed) naturally produce.

- OpenTelemetry has no standard for partial spans, and adding "update" semantics would complicate every reader.
- **Consequence:** a parent step only appears once it finishes, so its finished children can arrive pointing at a parent ID the viewer hasn't seen yet. The viewer handles this with placeholders (see [Viewer](#viewer)).
- In live agent sessions this matters little: if each agent command is wrapped in a `test.step`, every command is a short step that finishes and arrives promptly.

### 3. Test identity is separate metadata, not the root span

The root `playwright.test` span only exists at the end, but the viewer needs to know which test it is showing from the start. So the live store holds two metadata records alongside the spans:

- **`trace.started`**, written when the test begins. It carries `traceId`, `rootSpanId`, test title, file, line, describes, project and start time. The root span ID is already known up front, because the fixture creates the trace context before the test runs. Writing `trace.started` is what creates a live trace.
- **`trace.ended`**, written when the test ends. It carries the final status and end time, or `abandoned` if the trace times out without one.

### 4. A per-trace Durable Object with SQLite is the live store and the stream

Each live trace is one Durable Object. It stores every span as a row in its SQLite database and streams to viewers directly.

- **Ordering is solved outright.** The object handles one request at a time, so it assigns a real, monotonic sequence number to every event. No timestamp-keyed objects, and no overlap windows to catch writes that land out of order.
- **Dedupe is one SQL statement.** `spanId` is unique, and writes use `INSERT OR IGNORE`, so retried exports can't create duplicates.
- **Catch-up and live are one race-free request.** On connect, the object sends every row after the client's offset, then registers the connection. No new event can slip in between, because nothing else runs in the object meanwhile.
- **Push is instant.** When a write lands, the object fans it out to connected viewers straight away, with no polling anywhere.
- **Lifecycle lives in the object.** Alarms handle abandoned traces and expiry (see [Lifecycle](#lifecycle)).
- **Reading a whole trace is one query,** not a list followed by thousands of small object fetches.

Object storage is the wrong fit at this granularity. Flushing every few hundred milliseconds would produce well over a thousand tiny fragments per session. Each read would then mean listing them and fetching every one, and their timestamp keys don't give a reliable order.

### 5. R2 only stores screenshot frames, uploaded in batches

Frame bytes don't belong in SQLite: values are capped at about 2 MB, Durable Object storage costs more per GB, and frames would bloat every catch-up replay. Instead:

- The fixture collects frames and uploads them **in batches** (roughly every second), one request per batch.
- The trace-api writes each batch as **one immutable R2 object**: a ZIP with a manifest, in the same shape as today's `screenshots.zip`.
- The Durable Object then records a `frames` event that references the batch and lists its frames. Viewers learn about new frames through the same stream as spans.

R2 holds images and nothing else for live traces.

### 6. Stream to viewers with Server-Sent Events, served by the Durable Object

The viewer opens one `EventSource`, and the Durable Object answers with a `text/event-stream` response.

- **Resuming is built into SSE.** Each event's `id:` is its sequence number. When the connection drops, for example because the object restarted during a deploy, `EventSource` reconnects with `Last-Event-ID` and the object resumes after it.
- **Wire shape follows [Durable Streams](https://electric-sql.com/blog/2025/12/09/announcing-durable-streams).** That's ElectricSQL's open HTTP protocol for resumable streams: `offset=-1` to read from the start, and `live=sse` to follow. We'll follow that shape so we could aim for compatibility later, without depending on it now.
- **SSE keeps the object awake.** Only hibernatable WebSockets let an idle object leave memory, so an open SSE stream keeps the object in memory, billed for duration. For short sessions with a handful of viewers, the cost is negligible. Hibernatable WebSockets remain an option if viewer counts grow.
- **Heartbeats.** The object sends `: ping` comments every 15–30 seconds, so connections never look idle to Cloudflare's proxy.

### 7. Live traces are an optional part of the open-source trace-api

Live support ships in `@playwright-opentelemetry/trace-api` behind a small `LiveTraceHub` interface, passed as an optional `live` setting to `createTraceApi`.

- **The Durable Object class is exported but not deployed by default.** Hosts on Cloudflare add a binding to turn live traces on.
- **A local implementation keeps it portable.** An in-process version (in memory, or `node:sqlite`, which is built into Node 24) serves `bin/serve`, the e2e tests and self-hosting, using the same SQL and the same stream code.
- **Without it, nothing changes.** A host that doesn't configure `live` gets today's behaviour exactly. The live routes return 404, and the viewer falls back to its one-off static fetch.

### 8. Endform's P2P network proxy is not the viewer's transport

Endform's live sessions already tunnel commands from the agent's CLI to the runner over a P2P network proxy. We won't use it to feed viewers:

- the far end is a short-lived runner, so late joiners and post-session viewers get no history;
- browsers can't join that network without a bridge;
- it would only work inside Endform, not in the open-source package.

The runner can reach the trace-api over plain HTTPS, like it does for static traces.

### 9. Live frames come from Playwright's `page.screencast` API

We previously tried picking up Playwright's screenshot files with a recursive `fs.watch`. It was removed in `0ae77db` because it was unreliable, particularly on Linux. We then moved to extracting frames from `trace.zip` after the test, which only works once the test is over.

For live traces, the fixture uses the public **`page.screencast.start({ onFrame })`** API, added in Playwright 1.59.

- **It isn't a second screencast.** Playwright's server shares one browser screencast per page among all its consumers (tracing, video and API callers), so we receive the same frames Playwright already produces. If tracing started first, its size and quality settings win.
- **It works whether or not tracing is on.**
- **It fixes a page ID mismatch.** The fixture can tag frames with its own `browser.page.id`, which today doesn't match the Playwright-internal page GUID in screenshot file names.
- **Back-pressure.** Playwright waits for `onFrame` to return before it acknowledges a frame, so the callback must only add the frame to the current batch; uploads happen in the background.
- **Throttling is ours.** If our callback acknowledges quickly, the browser sends frames as fast as it renders them. We keep the latest frame, keep at most a few per second, and always keep one shortly after each action. Missing some frames is acceptable.
- **Static traces don't change.** They keep extracting frames from `trace.zip` after the test.

We also looked at tailing Playwright's traces directory directly. Frames are written there as they arrive, and the `.trace` JSON Lines file is flushed per frame. We rejected it because the path is private API, the on-disk format changed in 1.63, and it only works when the browser runs on the same machine.

## Proposed design

### Overview

```
reporter / fixture ──POST OTLP, PUT trace.started/ended──▶ trace-api ──RPC──▶ LiveTraceDO[traceId]
        │                                                      │                • SQLite: meta, spans, events
        └──POST frame batch──────────────────────────────▶ trace-api ──▶ R2   • sequence numbers, dedupe
                                                               └──RPC (frames event)──▶ • alarms: abandon, expire
                                                                                        • SSE fan-out
viewer ──GET /stream?offset=N (SSE)──────────────────────────────────────────────▶ LiveTraceDO[traceId]
viewer ──GET frame batch ZIP─────────────────────────────────────────────────────▶ R2 (immutable)
```

Objects are addressed by name (`idFromName`), derived from the trace ID plus a tenant key. A hook like today's `resolvePath` lets hosts such as Endform scope objects per organisation.

### Event model

Every event on the stream has a sequence number (`id:`) and one of these types:

```
trace.started  { traceId, rootSpanId, test: { title, file, line, describes, project }, startTime }
spans          { resourceSpans: [...] }                            // OTLP JSON, completed spans only
frames         { batchUrl, frames: [{ file, pageId, timestamp, width, height }] }
trace.ended    { status, endTime }                                 // status may be "abandoned"
```

Span payloads are plain OTLP JSON. Only the envelope, the metadata records and the frame references are ours.

### SQLite schema (sketch)

```sql
CREATE TABLE meta      (key TEXT PRIMARY KEY, value TEXT NOT NULL);   -- started, ended, expires_at
CREATE TABLE resources (id INTEGER PRIMARY KEY, hash TEXT UNIQUE NOT NULL, resource TEXT NOT NULL, scope TEXT NOT NULL);
CREATE TABLE events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,              -- 'span' | 'frames' | 'trace.started' | 'trace.ended'
  span_id     TEXT UNIQUE,                -- set for spans; NULL otherwise
  resource_id INTEGER REFERENCES resources(id),
  data        TEXT NOT NULL               -- span JSON, frames batch JSON, or metadata JSON
);
```

- **Spans are split per row on write.** Resource and scope attributes are stored once, in `resources`.
- **Rows are regrouped on read.** When streaming, consecutive span rows are merged back into OTLP `resourceSpans`, so one SSE event usually carries many spans.

### Write path

- **Starting a live trace:** `PUT /playwright-otel-reporter/v1/live-trace` with the `trace.started` record. This creates the object's state and sets its alarms. For live traces it takes the role today's `.expected` marker plays for static ones: untrusted OTLP data for this trace ID is accepted once it exists.
- **Spans:** `POST /v1/traces` as today. The handler splits the payload by trace ID and sends each live trace's spans to its object. Everything else takes today's static path.
- **Frames:** `POST /playwright-otel-reporter/v1/frames` with a batch ZIP and `x-trace-id`. The handler writes the ZIP to R2 under `live/{traceId}/frames/{batchId}.zip`, then appends a `frames` event to the object.
- **Ending:** `PUT /playwright-otel-reporter/v1/live-trace/end` with the `trace.ended` record. The object keeps accepting late spans afterwards, because services under test often export after the test is over.
- **Fixture:** a worker-scoped background exporter flushes completed spans every ~250–500 ms instead of once at teardown. The unmerged `jakob/nonblocking-fixture-network` branch (#42) is most of this already. It also batches and uploads screencast frames.
- **Reporter:** writes `trace.started` in `onTestBegin`, exports each step span from `onStepEnd`, and writes the test span and `trace.ended` in `onTestEnd`.

### Read path

- **Stream:** `GET /playwright-otel-trace-viewer/v1/{traceId}/stream?offset=-1&live=sse` is answered by the object. The offset comes from `Last-Event-ID` or `?offset=`.
- **Snapshot:** for a live trace, the existing `GET …/{traceId}/traces` returns a full OTLP export assembled from the object's rows. Tools that read whole traces today keep working on live traces unchanged.
- **Frames:** batch ZIPs are fetched from R2 with long-lived, immutable caching.
- **Auth:** `EventSource` can't set headers, so the stream uses the same `?traceToken=` query parameter as the existing viewer routes.

### Lifecycle

- **Abandoned traces.** An alarm fires a fixed time after `trace.started` (the maximum session duration). If no `trace.ended` has arrived by then, the object writes `trace.ended { status: "abandoned" }` and closes open streams.
- **Expiry.** A second alarm fires at `expires_at`, by default about a day after start and configurable per host. The object then calls `deleteAll()`, which removes its SQLite data and alarms.
- **Frame cleanup.** An R2 lifecycle rule on the `live/` prefix expires frame batches on the same schedule. The object can also delete its own batches before `deleteAll()`.

### Viewer

- **`TraceSource` abstraction** with two modes:
  - static (today's behaviour);
  - live (`EventSource` from an offset), which stops following on `trace.ended`.

  The viewer picks live mode when the stream route answers, and static mode when it returns 404.

- **Append-only store keyed by `spanId`.** It ignores duplicates and needs no update logic.
- **Header from `trace.started`**, with a LIVE badge and a ticking elapsed time based on server time.
- **Placeholder parents:** a span whose parent hasn't arrived yet is drawn under a placeholder for that parent ID. The placeholder runs from the earliest child's start to now and is replaced when the real span arrives.
- **Growing time axis:**
  - The duration is `max(now − start, last span end)`.
  - The viewport must no longer reset when the duration changes (`ViewportContext.tsx`).
  - A "follow live" mode tracks the newest activity, detaches when the user pans or zooms, and offers a "jump to live" button.
- **Stable rows:** once a span has a row in the layout, it keeps it, so rows don't jump as spans arrive.
- **Frames:**
  - The service worker already unpacks a screenshot ZIP and serves its frames by URL. It needs to accept a growing list of batch ZIPs per trace, instead of one ZIP cached forever.
  - A large "latest frame" panel shows what the browser looks like right now.

### Endform integration (motivating case)

To get a live URL out of an Endform live test session:

- **Durable Object:** deploy the `LiveTraceDurableObject` binding in Endform's trace-api Worker, plus an R2 lifecycle rule on `live/`.
- **Trace ID:** assign it when the session is created, and return a viewer URL from session start.
- **Telemetry:** live sessions currently run without it. Enable it in live mode, with a write credential that outlives the session.
- **Reporter events:** make sure test-begin and step events reach the reporter while the test runs.
- **Agent commands:** wrap each command in `test.step`, so each becomes a span carrying the code, exit code and output.

## Phasing

1. **Live store and stream, locally.**
   - The `LiveTraceHub` interface and its in-process implementation;
   - the live-trace start and end routes, routing OTLP to live traces, and the SSE stream route;
   - incremental fixture and reporter export;
   - the viewer's live source.

   All of this can be built and tested in this repo against a slow e2e test, with no Cloudflare dependency.

2. **The Durable Object implementation,** using the same SQL and stream code.
3. **Live frames:** `page.screencast`, batch uploads to R2, and multi-batch support in the service worker.
4. **Endform live session wiring** and the viewer URL.
5. **Polish:** follow mode, stable rows, placeholder parents.

## Open questions

- **What does one trace cover?** One trace per test attempt is simplest and matches today's model. A live session can also run dependency projects, so a per-session URL that redirects to the current attempt's trace might be needed.
- **Routing OTLP without an extra hop.** The OTLP handler has to find out whether a trace ID is live, which means asking its object on every request. Is that round trip acceptable? Or should live trace IDs be recognisable some other way, such as a registry, a KV flag, or reusing the `.expected` marker check?
- **Who writes `trace.started`?** The fixture already writes `.expected` at test start in the worker, while the reporter's `onTestBegin` runs in the main process.
- **Retention.** Is about a day the right default, and should it be configurable per trace or only per host? Do we ever want to turn a finished live trace into a static one, written to R2 in today's format, so it outlives the default?
- **Frame batching and latency.**
  - What batch interval, frame rate, size and quality should we use?
  - With batching, the latest frame shows up roughly one batch interval late. Is that acceptable, or should the latest frame per page also be pushed through the object for lower latency, with R2 batches as the history?
- **Event volume.** How much should the object coalesce span events per SSE message for chatty traces with many network spans? Do we need limits on rows per trace?
- **SSE vs. hibernatable WebSockets.** SSE keeps the object awake while viewers are connected. At what viewer count, or for what session length, is it worth switching?
- **Placeholder parents vs. "step started" records.** Is inferring placeholders from child spans good enough? Or do we want a lightweight "step started" event (name, span ID, parent, start), still without open spans?
- **Older Playwright.** Is "no live frames before 1.59" acceptable?
- **Shareable live URLs.** How long do read tokens live, and can a live URL be shared with someone who isn't signed in?
- **Durable Streams compatibility.** Is full compatibility worth aiming for, so its existing clients and conformance tests could be used?
- **rrweb.** The `oliver/test-rrweb` branch explored DOM-replay screenshots. A DOM event stream is small and naturally streamable, and could go through the object rather than R2. Is it a later upgrade to JPEG frames, or a separate direction?

## Alternatives considered

- **Open spans exported again on close.** Rejected; see decision 2.
- **R2 fragments with a server-side polling SSE route.** This was the previous draft of this document. A Worker would hold the SSE response open and list new fragments in R2 every ~500 ms. Rejected for three reasons:
  - Span-level flushing produces thousands of tiny objects.
  - Timestamp-keyed fragments need an overlap window to catch out-of-order writes.
  - Full reads become slow, and every update waits for the next poll.
- **R2 as the source of truth, with a Durable Object only as a notifier.** Same storage problems as above. The object would only remove the polling delay.
- **A Durable Object for the live window, compacted to R2 when the trace ends.** Unnecessary given the short retention. It's still available if live traces ever need to outlive it (see [Open questions](#open-questions)).
- **Storing frames in SQLite.** Rejected; see decision 5.
- **Browser polling the existing `traces` endpoint.** Wasteful, and it puts polling on every client.
- **P2P network proxy as transport.** Rejected; see decision 8.
- **Recursive `fs.watch` on the output directory.** Removed earlier for unreliability.
- **Tailing Playwright's traces directory.** Rejected; see decision 9.
- **Our own CDP `Page.startScreencast`.** Chromium-only, and it duplicates what `page.screencast` already exposes across browsers.
