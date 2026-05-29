# Playwright Trace Retention Publishing Plan

## Goal

Make `playwright-opentelemetry` publish OpenTelemetry output only when Playwright itself retained a trace attachment for that test result.

There should be no reporter option and no opt-out. The reporter should use Playwright's retained `trace.zip` attachment as the source of truth instead of reimplementing Playwright's trace mode logic.

## Implementation Structure

### Reporter Lifecycle

`onTestBegin` should continue to initialize internal state:

```ts
onTestBegin(test, result) {
	const traceId = getOrCreateTraceId(outputDir, testId);
	this.testTraceIds.set(testId, traceId);

	const testSpanId = generateSpanId();
	this.testSpans.set(testId, testSpanId);

	this.spanContextStacks.set(testId, [testSpanId]);
	writeCurrentSpanId(outputDir, testId, testSpanId);
	createNetworkDirs(outputDir, testId);
}
```

`onTestBegin` should no longer mutate `result.attachments` with `playwright-opentelemetry-trace-id`.

### Publishing Decision

`onTestEnd` should compute the retained trace attachment once and use it as the publishing gate:

```ts
const traceAttachment = result.attachments.find(
	(attachment) =>
		attachment.name === "trace" &&
		attachment.contentType === "application/zip" &&
		attachment.path,
);

const shouldPublish = Boolean(traceAttachment?.path);
```

This should be the only policy. Do not inspect `result.retry`, `result.status`, `test.expectedStatus`, or Playwright trace mode strings to decide whether to publish.

### Span Construction

`onTestEnd` may keep building test, step, and network spans as it does today so timing and cleanup behavior stay localized.

Only after building the per-test span array should the reporter branch on `shouldPublish`:

```ts
const testSpans = [testSpan, ...stepSpans, ...networkSpans];

if (!shouldPublish) {
	return;
}

result.attachments.push({
	name: "playwright-opentelemetry-trace-id",
	contentType: "text/plain",
	body: Buffer.from(traceId, "utf-8"),
});

this.spans.push(...testSpans);
```

### Trace ZIP And Trace API Output

Screenshot extraction, local OTel zip creation, and trace API uploads should happen only inside the publishing branch:

```ts
const screenshots = await extractScreenshotsFromPlaywrightTrace(
	traceAttachment.path,
);

if (this.options.storeTraceZip) {
	await createTraceZip(...);
}

if (this.resolvedTraceApiEndpoint) {
	await this.sendTestJsonToTraceApi(...);
}
```

There should be no fallback that creates an OTel-only zip without a Playwright-retained trace.

### End Of Run

`onEnd` can continue sending `this.spans` to configured OTLP destinations. Since `this.spans` will only contain eligible tests, no additional filtering should be needed there.

Cleanup should still run for all tests that entered `onBegin`, regardless of whether they published.

## Unit Test Skeletons

Skeleton names are in `reporter/test-unit/playwright-trace-retention.test.ts`.

Main groups:

- `PlaywrightOpentelemetryReporter - Playwright trace retention publishing`
- `PlaywrightOpentelemetryReporter - Playwright trace mode matrix`

The first group should use reporter harness tests and direct lifecycle calls to validate the reporter's attachment gate.

The second group can start as unit-level simulations using retained/non-retained attachment fixtures. If direct Playwright e2e coverage is practical, promote the matrix cases into e2e tests that let Playwright produce the actual attachments.

## Existing Tests To Update Later

Many current reporter unit tests assume spans are always published. During implementation, tests that assert span contents should add a retained trace attachment to their `result` fixture.

Tests that should intentionally cover skipped publication should omit the retained trace attachment and assert no publishing side effects.

Expected updates include:

- `reporter/test-unit/reporter-tests.test.ts`
- `reporter/test-unit/reporter-steps.test.ts`
- `reporter/test-unit/trace-api.test.ts`
- `reporter/test-unit/trace-zip.test.ts`

## Trace Attachment Fixture Shape

Use this shape for published test cases:

```ts
attachments: [
	{
		name: "trace",
		contentType: "application/zip",
		path: traceZipPath,
	},
]
```

Use these shapes for negative cases:

```ts
attachments: []
```

```ts
attachments: [
	{
		name: "trace",
		contentType: "application/zip",
	},
]
```

```ts
attachments: [
	{
		name: "trace",
		contentType: "text/plain",
		path: traceZipPath,
	},
]
```

```ts
attachments: [
	{
		name: "not-trace",
		contentType: "application/zip",
		path: traceZipPath,
	},
]
```

## Verification Plan

After implementation, run from the workspace root:

```bash
pnpm test
pnpm tsc
```

If browser dependencies and network access are available, also run:

```bash
pnpm --filter playwright-opentelemetry build
pnpm --filter playwright-opentelemetry test:e2e
```

## Documentation Updates

Update `README.md` to explain that reporter output follows Playwright trace retention. Users who want OTel output for every test should configure Playwright `use.trace` so Playwright retains a trace for every test, such as `trace: "on"` or object mode with `mode: "on"`.

Clarify that `storeTraceZip: true` stores OTel trace zips only for tests with retained Playwright trace attachments.

## Non-Goals

- Do not add `uploadPolicy`.
- Do not parse Playwright trace mode settings in the reporter.
- Do not infer retention from retry/status/expected status.
- Do not publish OTel-only traces when Playwright did not retain a trace zip.
- Do not implement Lambda Runner changes in this repository.
