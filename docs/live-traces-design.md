# Live Traces Design

Status: **Draft / direction-setting.** This document records the direction we're exploring for viewing traces while a test is still running, the decisions taken so far, and the questions that are still open. Nothing here is implemented yet.

## Goal

Let someone open a trace viewer URL while a test is running and see:

1. everything that has been recorded so far, and then
2. new spans and screenshots as they arrive, pushed to the browser rather than polled by it.

The motivating case is an agent driving a live, interactive test session (for example Endform's live test sessions). We want to hand out a URL that shows what the agent is exploring as it happens. The same machinery should work for any long-running test in CI.

## Where we are today

Every layer assumes a trace is complete before anyone reads it.

| Layer       | Current behaviour                                                                                                                                                                                                                                                                | Why it blocks live viewing                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Reporter    | `onTestBegin` and `onStepBegin` are empty. All test and step spans are built in `onTestEnd` and exported once, in `onEnd`.                                                                                                                                                       | Nothing reaches storage until the run ends.                              |
| Fixture     | Browser and network spans are collected in memory and sent in one POST at fixture teardown.                                                                                                                                                                                      | Nothing reaches storage until the test ends.                             |
| Screenshots | Pulled out of Playwright's `trace.zip` after the test and uploaded as one `screenshots.zip`.                                                                                                                                                                                     | Only one upload per trace, at the very end.                              |
| Trace API   | Append-only fragments (`traces/{traceId}/traces/{Date.now()}-{uuid}.json`), merged on read. No cursor or lifecycle state. `screenshots.zip` is served with `Cache-Control: public, max-age=600`. `S3Storage.list` reads a single page (≤ 1000 keys).                             | No way to ask "what's new since X", and screenshot responses are cached. |
| Viewer      | Fetches `traces` and `screenshots.zip` once. `deriveTestInfoFromOtlpExport` throws if there is no `playwright.test` span. The time axis is fixed to the root span, and the viewport resets when the duration changes. The service worker caches each screenshot ZIP permanently. | Can't render a trace without its root span, and can't grow.              |

The good news: append-only fragments merged on read are already most of what a live log needs.

## Decisions so far

### 1. Export completed spans only, with no open or partial spans

We will not export a span when it starts and again when it ends. Spans are exported once, when they finish, which is what the reporter (`onStepEnd`, `onTestEnd`) and fixture (request finished, page closed) naturally produce.

- OpenTelemetry has no standard for partial spans, and adding "update" semantics would complicate every reader.
- **Consequence:** a parent step only appears once it finishes, so its finished children can arrive pointing at a parent ID the viewer hasn't seen yet. The viewer handles this with placeholders (see [Viewer](#viewer)).
- In live agent sessions this matters little: if each agent command is wrapped in a `test.step`, every command is a short step that finishes and arrives promptly.

### 2. Test identity is separate metadata, not the root span

The root `playwright.test` span only exists at the end, but the viewer needs to know which test it is showing from the start. So we write small metadata records alongside the spans:

- **`trace.started`**, written when the test begins. It carries `traceId`, `rootSpanId`, test title, file, line, describes, project and start time. The root span ID is already known up front, because the fixture creates the trace context before the test runs.
- **`trace.ended`**, written when the test ends. It carries the final status and end time.

The existing `.expected` marker is written at the same moment `trace.started` would be. One option is for `trace.started` to replace it (see [Open questions](#open-questions)).

### 3. Object storage stays the source of truth

All live data is written to the same `TraceStorage` (S3 or R2) the static path uses. The live path adds no separate database. A viewer that joins late, or opens the trace after it has finished, reads the same objects.

### 4. Push to the viewer with Server-Sent Events, polling storage on the server

The browser opens one `EventSource`. A trace-api route holds the SSE response open, lists new objects in storage on an interval (~500 ms–1 s), and pushes them as events.

- **The browser doesn't poll.** It gets a stream, and polling happens server-side next to the storage.
- **It's portable.** The route only depends on the `TraceStorage` interface and H3's SSE support, so it works on Cloudflare Workers, Node (`bin/serve`), Deno and Bun, against both S3 and R2.
- **It's cheap on Workers.** Workers bill CPU time, not wall-clock time, so a response that mostly waits between polls costs very little.
- **Resuming is built into SSE.** Each event's `id:` is a cursor. When the connection drops, `EventSource` reconnects with `Last-Event-ID` and the server continues from there.
- Catch-up and live updates are one request: the server first sends everything after the cursor, then keeps the stream open for new events.

### 5. A Durable Object is optional and comes later

We considered making a per-trace Durable Object the core: it would assign sequence numbers, store recent events in SQLite, and fan them out over SSE or hibernatable WebSockets. We decided against requiring it.

- Polling R2 from the server gets us most of the value without any stateful component.
- A Durable Object can be added later as an optional extra that the open-source package exports but doesn't require you to deploy. It would act as a **notifier**: the write path pokes it, and connected streams re-list immediately instead of waiting for the next poll. It could also become the ordering authority, assigning real sequence numbers.
- Either way, storage stays the source of truth and the SSE protocol doesn't change.

### 6. Endform's P2P network proxy is not the viewer's transport

Endform's live sessions already tunnel commands from the agent's CLI to the runner over a P2P network proxy. We won't use it to feed viewers:

- the far end is a short-lived runner, so late joiners and post-session viewers get no history;
- browsers can't join that network without a bridge;
- it would only work inside Endform, not in the open-source package.

The runner can reach the trace-api over plain HTTPS, like it does for static traces.

### 7. Live screenshots come from Playwright's `page.screencast` API

We previously tried picking up Playwright's screenshot files with a recursive `fs.watch`. It was removed in `0ae77db` because it was unreliable, particularly on Linux. We then moved to extracting frames from `trace.zip` after the test, which only works once the test is over.

For live frames, the fixture will use the public **`page.screencast.start({ onFrame })`** API, added in Playwright 1.59.

- **It isn't a second screencast.** Playwright's server shares one browser screencast per page among all its consumers (tracing, video and API callers), so we receive the same frames Playwright already produces. If tracing started first, its size and quality settings win.
- **It works whether or not tracing is on.**
- **It fixes a page ID mismatch.** The fixture can tag frames with its own `browser.page.id`, which today doesn't match the Playwright-internal page GUID in screenshot file names.
- **Back-pressure.** Playwright waits for `onFrame` to return before it acknowledges a frame, so the callback must only queue the frame; uploads happen in the background.
- **Throttling is ours.** If our callback acknowledges quickly, the browser sends frames as fast as it renders them. We keep the latest frame, send at most a few per second, and always send one shortly after each action. Missing some frames is acceptable.
- **Final artifacts don't change.** Extracting frames from `trace.zip` after the test stays the source for the final screenshot artifact.

We also looked at tailing Playwright's traces directory directly. Frames are written there as they arrive, and the `.trace` JSON Lines file is flushed per frame. We rejected it because the path is private API, the on-disk format changed in 1.63, and it only works when the browser runs on the same machine.

### 8. Model the stream API on Durable Streams, without depending on it

[Durable Streams](https://electric-sql.com/blog/2025/12/09/announcing-durable-streams) is an open HTTP protocol from ElectricSQL for exactly this pattern: opaque, monotonic offsets; `offset=-1` to read from the start; and `live=sse` or `long-poll` to follow the stream. We'll use its shape for our endpoint so we could aim for compatibility later, but we won't take a dependency on it now.

## Proposed design

### Event model

Every event on the stream has a cursor (`id:`) and one of these types:

```
trace.started  { traceId, rootSpanId, test: { title, file, line, describes, project }, startTime }
spans          { resourceSpans: [...] }           // OTLP JSON, completed spans only
frame          { pageId, timestamp, url, width, height }
trace.ended    { status, endTime }
```

Content uses existing standards where possible: span payloads are plain OTLP JSON, exactly what the fragments already contain. Only the envelope and the metadata records are ours.

### Storage layout

```
traces/{traceId}/
├── .expected                     # existing marker (may become trace.started)
├── meta/started.json             # trace.started (new)
├── meta/ended.json               # trace.ended (new)
├── traces/{ts}-{uuid}.json       # existing OTLP fragments
├── frames/{ts}-{pageId}.jpeg     # live frames, immutable (new)
└── screenshots.zip               # existing final artifact
```

- Frames are individually addressed, immutable objects, so they can be served with long-lived caching. Their bytes never travel inside the stream; `frame` events only carry the URL.
- `TraceStorage.list` needs a `startAfter` option (supported by R2 and S3 `ListObjectsV2`) and pagination.

### Write path

- **Fixture:** a worker-scoped background exporter flushes completed spans every ~250–500 ms instead of once at teardown. The unmerged `jakob/nonblocking-fixture-network` branch (#42) is most of this already. The fixture also uploads screencast frames.
- **Reporter:** writes `trace.started` in `onTestBegin`, exports each step span from `onStepEnd`, and writes the test span plus `trace.ended` in `onTestEnd`.
- **Retention:** modes such as `retain-on-failure` can only decide at the end of a test. Streaming is opt-in, and when it's on, the trace is retained (see [Open questions](#open-questions)).
- **Dedupe:** since each span is exported once, retries are the only source of duplicates. Readers dedupe by `spanId`.

### Read path

New route: `GET /playwright-otel-trace-viewer/v1/{traceId}/stream`.

- **Cursor:** the cursor comes from `Last-Event-ID` or `?offset=`, and `-1` means from the start.
- **Ordering:** fragment keys are timestamps taken by whichever trace-api instance handled the write, so two concurrent writes can land out of key order. The route lists from a short overlap window before the cursor and remembers which keys it has already sent on this connection. Duplicates after a reconnect are harmless, because the viewer dedupes.
- **Heartbeats:** the route sends `: ping` comments between polls, so the connection never looks idle.
- **Bounded connections:** the route deliberately ends the stream every few minutes. `EventSource` reconnects with `Last-Event-ID`, which keeps each request well inside per-request limits (Workers' subrequest limit, runtime restarts, idle timeouts).
- **End of trace:** when the route sees `meta/ended.json`, it sends `trace.ended` and closes the stream.
- **Auth:** `EventSource` can't set headers, so auth uses the same `?traceToken=` query parameter as the existing viewer routes.
- **Without the route:** hosts that don't enable the route return 404, and the viewer falls back to today's one-off fetch.

### Viewer

- **`TraceSource` abstraction** with two modes:
  - static (today's behaviour);
  - live (`EventSource` from a cursor), which stops on `trace.ended`.
- **Append-only store keyed by `spanId`.** It ignores duplicates, and needs no update logic.
- **Header from `trace.started`**, with a LIVE badge and a ticking elapsed time based on server time.
- **Placeholder parents:** a span whose parent hasn't arrived yet is drawn under a placeholder for that parent ID. The placeholder runs from the earliest child's start to now and is replaced when the real span arrives.
- **Growing time axis:**
  - The duration is `max(now − start, last span end)`.
  - The viewport must no longer reset when the duration changes (`ViewportContext.tsx`).
  - A "follow live" mode tracks the newest activity, detaches when the user pans or zooms, and offers a "jump to live" button.
- **Stable rows:** once a span has a row in the layout, it keeps it, so rows don't jump as spans arrive.
- **Frames:** loaded by direct URL, bypassing the service worker's ZIP path. A large "latest frame" panel shows what the browser looks like right now.

### Endform integration (motivating case)

To get a live URL out of an Endform live test session:

- **Trace ID:** assign it when the session is created, and return a viewer URL from session start.
- **Telemetry:** enable it for live sessions, which currently run without it. Use a write credential that outlives the session.
- **Reporter events:** make sure test-begin and step events reach the reporter while the test runs.
- **Agent commands:** wrap each command in `test.step`, so each becomes a span carrying the code, exit code and output.

## Phasing

1. **Library-only streaming:**
   - `trace.started` / `trace.ended` metadata;
   - incremental fixture and reporter export;
   - `list` with `startAfter`;
   - the SSE stream route;
   - the viewer's live source.

   All of this can be built and tested in this repo against a slow e2e test.

2. **Live frames** via `page.screencast` and per-frame storage.
3. **Endform live session wiring** and the viewer URL.
4. **Polish:** follow mode, stable rows, an optional Durable Object notifier, and compacting live frames into `screenshots.zip` at the end.

## Open questions

- **What does one trace cover?** One trace per test attempt is simplest and matches today's model. A live session can also run dependency projects, so a per-session URL that redirects to the current attempt's trace might be needed.
- **Streaming in normal CI runs.** Is streaming ever on outside live sessions? If so, how does it interact with `retain-on-failure`? We could delete a streamed trace after a pass instead of never writing it.
- **Who writes `trace.started`?** The fixture already writes `.expected` at test start in the worker, while the reporter's `onTestBegin` runs in the main process. Should `trace.started` replace `.expected`?
- **Cursor format and ordering.**
  - How big should the overlap window be?
  - Should the cursor be a timestamp, a key, or a per-prefix pair (fragments and frames)?
  - Is the overlap good enough, or do we eventually want an ordering authority, such as the optional Durable Object?
- **Placeholder parents vs. "step started" records.** Is inferring placeholders from child spans good enough? Or do we want a lightweight "step started" side record (name, span ID, parent, start), still without open spans?
- **Frame budget.**
  - What rate, size and quality should we capture at?
  - What are the storage costs per session, and when do we delete frames?
  - Do we compact frames into `screenshots.zip` at the end?
- **Older Playwright.** Is "no live frames before 1.59" acceptable?
- **Abandoned traces.** If `trace.ended` never arrives (a crashed runner), when does the viewer and stream route treat the trace as abandoned?
- **Shareable live URLs.** How long do read tokens live, and can a live URL be shared with someone who isn't signed in?
- **Durable Streams compatibility.** Is full compatibility worth aiming for, so its existing clients and conformance tests could be used?
- **rrweb.** The `oliver/test-rrweb` branch explored DOM-replay screenshots. A DOM event stream is smaller and naturally streamable. Is it a later upgrade to JPEG frames, or a separate direction?

## Alternatives considered

- **Open spans exported again on close.** Rejected; see decision 1.
- **Browser polling the existing `traces` endpoint.** Simple, but wasteful, and it puts polling on every client. The server-side SSE route replaces it.
- **Durable Object as the core of the live path.** Deferred; see decision 5.
- **Durable Object serving SSE directly.** Possible, since a Durable Object can stream a `text/event-stream` response. But only hibernatable WebSockets let an idle object leave memory; an open SSE stream keeps it awake and billed for duration. Fine at small scale, but unnecessary given decision 4.
- **P2P network proxy as transport.** Rejected; see decision 6.
- **Recursive `fs.watch` on the output directory.** Removed earlier for unreliability.
- **Tailing Playwright's traces directory.** Rejected; see decision 7.
- **Our own CDP `Page.startScreencast`.** Chromium-only, and it duplicates what `page.screencast` already exposes across browsers.
