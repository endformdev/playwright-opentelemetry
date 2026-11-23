import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type {
	FullConfig,
	FullResult,
	Reporter,
	Suite,
	TestCase,
	TestResult,
	TestStep,
} from "@playwright/test/reporter";
import {
	FIXTURE_SPANS_ATTACHMENT_NAME,
	TRACE_CONTEXT_ATTACHMENT_NAME,
} from "../fixture/trace-context";
import {
	type PlaywrightOpentelemetryConfig,
	type PlaywrightOpentelemetryUseOptions,
	type ResolvedPlaywrightOpentelemetryDestination,
	type ResolvedPlaywrightOpentelemetryConfig,
	resolvePlaywrightOpentelemetryConfig,
} from "../shared/config";
import {
	generateSpanId,
	generateTraceId,
	PLAYWRIGHT_TRACE_API_SOURCE_HEADER,
	PLAYWRIGHT_TRACE_API_SOURCE_REPORTER,
	type SendSpansOptions,
	type Span,
	withPlaywrightTraceApiHeaders,
} from "../shared/otel";
import {
	type PlaywrightTraceOption,
	shouldRetainPlaywrightTrace,
} from "../shared/playwright-trace";
import { filterRetainedDestinations } from "../shared/destinations";
import {
	API_REQUESTS_ATTACHMENT_NAME,
	apiRequestHttpAttributes,
	type CapturedApiRequest,
	parseApiRequestsHandoff,
} from "../shared/api-requests";
import {
	API_REQUESTS_HANDOFF_FILE,
	FIXTURE_SPANS_HANDOFF_FILE,
	fixtureHandoffDir,
	fixtureHandoffRoot,
	SCREENSHOTS_HANDOFF_FILE,
	TRACE_CONTEXT_HANDOFF_FILE,
} from "../shared/fixture-handoff";
import { supportsScreencastScreenshots } from "../shared/screencast-screenshots";
import {
	createScreenshotsZip,
	readScreenshotsZip,
	SCREENSHOTS_ATTACHMENT_NAME,
	type ScreenshotResource,
} from "../shared/screenshots-zip";
import {
	ATTR_CODE_COLUMN_NUMBER,
	ATTR_CODE_FILE_PATH,
	ATTR_CODE_LINE_NUMBER,
	ATTR_TEST_CASE_NAME,
	ATTR_TEST_CASE_RESULT_STATUS,
	ATTR_TEST_CASE_TITLE,
} from "./otel-attributes";
import {
	ATTR_TEST_PHASE,
	ATTR_TEST_STEP_CATEGORY,
	ATTR_TEST_STEP_NAME,
	ATTR_TEST_STEP_PARAM_PREFIX,
	ATTR_TEST_STEP_SUBTITLE,
	ATTR_TEST_STEP_TITLE,
	TEST_SPAN_NAME,
	TEST_STEP_SPAN_NAME,
} from "./reporter-attributes";
import {
	ApiRequestMatcher,
	type ApiRequestStepCall,
	apiRequestStepCall,
	isApiRequestWrapperFile,
} from "./api-request-matcher";
import { extractScreenshotsFromPlaywrightTrace } from "./legacy/trace-zip-screenshots";
import { sendSpans } from "./sender";
import { createTraceZipBlob, writeTraceZip } from "./trace-zip-builder";

export type { Span } from "../shared/otel";

type SpanBatch = {
	spans: Span[];
	config: ResolvedPlaywrightOpentelemetryConfig;
};

type SpanDestination = {
	kind: "trace-api" | "otlp";
	spans: Span[];
	options: SendSpansOptions;
};

type SpanSendFailure = {
	destination: SpanDestination;
	error: unknown;
};

type PendingTraceArtifact = {
	outputDir: string;
	test: TestCase;
	prepared: Promise<PreparedTraceArtifactResult>;
};

type PrepareTraceArtifactOptions = {
	test: TestCase;
	spans: Span[];
	fixtureSpans: Span[];
	screenshotsZip?: Buffer<ArrayBuffer>;
	traceAttachmentPath?: string;
	traceId: string;
	config: ResolvedPlaywrightOpentelemetryConfig;
	playwrightVersion: string;
};

type PreparedTraceArtifactResult = { traceZipBlob?: Blob } | { error: unknown };

type PreparedTraceArtifact = {
	traceZipBlob?: Blob;
};

export class PlaywrightOpentelemetryReporter implements Reporter {
	private spanBatches: SpanBatch[] = [];
	private pendingTraceArtifacts: PendingTraceArtifact[] = [];
	private fixtureHandoffRoots = new Set<string>();
	private rootDir?: string;
	private playwrightVersion?: string;
	private warnedAboutVisibleWrapper = false;
	private debug = false;

	constructor() {}

	onBegin(config: FullConfig, _suite: Suite) {
		this.rootDir = config.rootDir;
		this.playwrightVersion = config.version;

		const projects = Array.isArray(config.projects) ? config.projects : [];
		for (const project of projects) {
			const resolvedConfig = resolvePlaywrightOpentelemetryConfig(
				getProjectPlaywrightOpentelemetryConfig(project),
				{ requireDestination: true },
			);
			this.debug ||= resolvedConfig.debug;
		}
	}

	onTestBegin(_test: TestCase, _result: TestResult) {}

	onStepBegin(_test: TestCase, _result: TestResult, _step: TestStep) {}

	onStepEnd(_test: TestCase, _result: TestResult, _step: TestStep) {}

	onTestEnd(test: TestCase, result: TestResult): void {
		const fixtureData = this.takeFixtureData(test, result);
		const config = getTestConfig(test);
		const traceAttachment = result.attachments.find(
			(attachment) =>
				attachment.name === "trace" &&
				attachment.contentType === "application/zip" &&
				attachment.path,
		);
		const traceRetentionTestInfo = {
			expectedStatus: test.expectedStatus,
			retry: result.retry,
			status: result.status,
		};
		const shouldRetainTrace = (trace: PlaywrightTraceOption | null) =>
			trace === null
				? Boolean(traceAttachment)
				: shouldRetainPlaywrightTrace(trace, traceRetentionTestInfo);
		const shouldStoreTraceZip =
			config.storeTraceZip && shouldRetainTrace(config.trace);
		const retainedConfig: ResolvedPlaywrightOpentelemetryConfig = {
			...config,
			otlpDestinations: filterRetainedDestinations(
				config.otlpDestinations,
				config.trace,
				shouldRetainTrace,
			),
			playwrightTraceApiDestinations: filterRetainedDestinations(
				config.playwrightTraceApiDestinations,
				config.trace,
				shouldRetainTrace,
			),
			storeTraceZip: shouldStoreTraceZip,
		};

		if (!hasPlaywrightOpentelemetryDestination(retainedConfig)) {
			return;
		}

		const testId = test.id;
		const outputDir = getTestOutputDir(test);
		const { traceId, rootSpanId: testSpanId } = parseTraceContext(
			fixtureData.traceContext,
			testId,
		);
		const fixtureSpans = retainedConfig.storeTraceZip
			? parseFixtureSpans(fixtureData.fixtureSpans, testId)
			: [];

		result.annotations.push({
			type: "playwrightOpentelemetryTraceId",
			description: traceId,
		});

		const attributes: Record<string, string | number | boolean | string[]> = {};

		// titlePath format: ['', 'project', 'filename', ...describes, 'testname']
		// We want: [...describes, 'testname'] joined with ' > '
		const titlePath = test.titlePath();
		if (titlePath.length >= 3) {
			// Skip root (''), project name, and filename to get describes and test name
			const caseName = titlePath.slice(3).join(" > ");
			attributes[ATTR_TEST_CASE_NAME] = caseName;
		}

		const describes = titlePath.length > 4 ? titlePath.slice(3, -1) : [];

		attributes[ATTR_TEST_CASE_TITLE] = test.title;
		attributes[ATTR_TEST_CASE_RESULT_STATUS] =
			result.status === "passed" ? "pass" : "fail";
		attributes["playwright.test.status"] = result.status;
		attributes["playwright.test.describes"] = describes;

		if (test.location) {
			const { file, line, column } = test.location;
			const relativePath = this.rootDir
				? path.relative(this.rootDir, file)
				: file;

			attributes[ATTR_CODE_FILE_PATH] = relativePath;
			attributes[ATTR_CODE_LINE_NUMBER] = line;
			attributes[ATTR_CODE_COLUMN_NUMBER] = column;
		}

		// Process test steps recursively first to collect all child spans.
		// Every step in the finished tree is its own step: identical steps that
		// start in the same millisecond, like back-to-back assertions, are not
		// duplicates.
		const stepSpans: Span[] = [];
		const apiRequests = new ApiRequestMatcher(
			parseApiRequests(fixtureData.apiRequests, testId),
			this.rootDir,
		);
		for (const step of result.steps ?? []) {
			this.processTestStep(
				step,
				testSpanId,
				traceId,
				[],
				stepSpans,
				apiRequests,
			);
		}
		// Calls no step reported still happened: keep them, under the test.
		for (const request of apiRequests.unmatched()) {
			stepSpans.push(
				unmatchedApiRequestSpan(request, { traceId, parentSpanId: testSpanId }),
			);
		}
		if (apiRequests.wrapperWasVisible && !this.warnedAboutVisibleWrapper) {
			this.warnedAboutVisibleWrapper = true;
			console.warn(
				`Playwright ${this.playwrightVersion ?? ""} reports playwright-opentelemetry's request wrapper as the location of request steps. Traces still have the right locations, but Playwright's own reports don't. Please report this to playwright-opentelemetry.`,
			);
		}

		// Calculate test span timing to encompass all child spans
		// Start with Playwright's reported timing as the baseline
		let minStartTime = result.startTime;
		let maxEndTime = new Date(result.startTime.getTime() + result.duration);

		// Expand bounds based on step spans (includes hooks, fixtures, etc.)
		for (const stepSpan of stepSpans) {
			if (stepSpan.startTime < minStartTime) {
				minStartTime = stepSpan.startTime;
			}
			if (stepSpan.endTime > maxEndTime) {
				maxEndTime = stepSpan.endTime;
			}
		}

		const span: Span = {
			traceId,
			spanId: testSpanId,
			name: TEST_SPAN_NAME,
			startTime: minStartTime,
			endTime: maxEndTime,
			attributes,
		};
		if (result.status !== test.expectedStatus) {
			span.status = { code: 2 };
		}

		// Build the final spans array with test span first
		const testSpans: Span[] = [span, ...stepSpans];

		// Fixture/browser spans are sent directly by the fixture to avoid serializing
		// them through the reporter except when local ZIP storage needs them.
		this.spanBatches.push({ spans: testSpans, config: retainedConfig });

		if (
			retainedConfig.storeTraceZip ||
			hasTraceApiDestination(retainedConfig)
		) {
			const prepared = this.prepareTraceArtifact({
				test,
				spans: testSpans,
				fixtureSpans,
				screenshotsZip: fixtureData.screenshotsZip,
				traceAttachmentPath: traceAttachment?.path,
				traceId,
				config: retainedConfig,
				playwrightVersion: this.playwrightVersion || "unknown",
			}).catch((error: unknown) => ({ error }));

			this.pendingTraceArtifacts.push({
				outputDir,
				test,
				prepared,
			});
		}
	}

	async onEnd(_result: FullResult) {
		// Each attempt's directory is gone by now. Only removes an empty root,
		// never files left for a test this run didn't report.
		for (const root of this.fixtureHandoffRoots) {
			await fs.rmdir(root).catch(() => {});
		}

		const destinations = new Map<string, SpanDestination>();

		for (const batch of this.spanBatches) {
			for (const destination of batch.config.otlpDestinations) {
				if (!destination.url) {
					continue;
				}

				addDestinationSpans(destinations, batch.spans, "otlp", {
					tracesEndpoint: destination.url,
					headers: destination.headers,
					playwrightVersion: this.playwrightVersion || "unknown",
					debug: batch.config.debug,
				});
			}

			for (const destination of batch.config.playwrightTraceApiDestinations) {
				if (!destination.url) {
					continue;
				}

				addDestinationSpans(destinations, batch.spans, "trace-api", {
					tracesEndpoint: `${destination.url}/v1/traces`,
					headers: withPlaywrightTraceApiHeaders(destination.headers),
					playwrightVersion: this.playwrightVersion || "unknown",
					debug: batch.config.debug,
				});
			}
		}

		const failuresPerDestination = await Promise.all(
			[...destinations.values()].map(
				async (destination): Promise<SpanSendFailure[]> => {
					try {
						await sendSpans(destination.spans, destination.options);
						return [];
					} catch (error) {
						return [{ destination, error }];
					}
				},
			),
		);
		const sendFailures = failuresPerDestination.flat();

		for (const failure of sendFailures) {
			console.warn(
				`Failed to send spans to ${failure.destination.options.tracesEndpoint}: ${errorMessage(failure.error)}`,
			);
		}

		for (const artifact of this.pendingTraceArtifacts) {
			const prepared = await artifact.prepared;
			if ("error" in prepared) {
				throw prepared.error;
			}

			if (prepared.traceZipBlob) {
				await writeTraceZip(
					artifact.outputDir,
					artifact.test,
					prepared.traceZipBlob,
				);
			}
		}

		const traceApiFailure = sendFailures.find(
			(failure) => failure.destination.kind === "trace-api",
		);
		if (traceApiFailure) {
			throw traceApiFailure.error;
		}
	}

	/**
	 * What the fixture handed over for this test attempt: its attachments with
	 * `attachFixtureData`, otherwise the files in the attempt's handoff
	 * directory, which is deleted here whether or not the test is reported.
	 */
	private takeFixtureData(test: TestCase, result: TestResult): FixtureData {
		const attachment = (name: string) =>
			result.attachments.find((attachment) => attachment.name === name);
		const screenshotsAttachmentPath = attachment(
			SCREENSHOTS_ATTACHMENT_NAME,
		)?.path;
		const attached: FixtureData = {
			traceContext: attachment(TRACE_CONTEXT_ATTACHMENT_NAME)?.body,
			fixtureSpans: attachment(FIXTURE_SPANS_ATTACHMENT_NAME)?.body,
			apiRequests: attachment(API_REQUESTS_ATTACHMENT_NAME)?.body,
			screenshotsZip: screenshotsAttachmentPath
				? readFixtureFile(screenshotsAttachmentPath, { required: true })
				: undefined,
		};

		const outputDir = getProjectOutputDir(test);
		if (!outputDir) {
			return attached;
		}
		this.fixtureHandoffRoots.add(fixtureHandoffRoot(outputDir));
		const dir = fixtureHandoffDir(outputDir, test.id, result.retry);
		try {
			return {
				traceContext:
					attached.traceContext ??
					readFixtureFile(path.join(dir, TRACE_CONTEXT_HANDOFF_FILE)),
				fixtureSpans:
					attached.fixtureSpans ??
					readFixtureFile(path.join(dir, FIXTURE_SPANS_HANDOFF_FILE)),
				apiRequests:
					attached.apiRequests ??
					readFixtureFile(path.join(dir, API_REQUESTS_HANDOFF_FILE)),
				screenshotsZip:
					attached.screenshotsZip ??
					readFixtureFile(path.join(dir, SCREENSHOTS_HANDOFF_FILE)),
			};
		} finally {
			fsSync.rmSync(dir, { recursive: true, force: true });
		}
	}

	private async prepareTraceArtifact(
		options: PrepareTraceArtifactOptions,
	): Promise<PreparedTraceArtifact> {
		const screenshots = await readTestScreenshots(options);

		const traceZipBlobPromise = options.config.storeTraceZip
			? createTraceZipBlob({
					test: options.test,
					spans: options.spans,
					fixtureSpans: options.fixtureSpans,
					playwrightVersion: options.playwrightVersion,
					screenshots,
				})
			: undefined;

		// Without screenshots there is nothing to upload: the Trace API answers
		// a missing screenshots ZIP with 404, which the viewer shows as none.
		const screenshotsZip =
			screenshots.length > 0 ? await createScreenshotsZip(screenshots) : null;
		const uploadPromises = screenshotsZip
			? options.config.playwrightTraceApiDestinations
					.filter((destination) => destination.url)
					.map((destination) =>
						this.sendScreenshotsZipToTraceApi({
							traceId: options.traceId,
							screenshotsZip,
							destination,
						}),
					)
			: [];

		const [traceZipBlob] = await Promise.all([
			traceZipBlobPromise,
			...uploadPromises,
		]);

		return {
			traceZipBlob,
		};
	}

	private processTestStep(
		step: TestStep,
		parentSpanId: string,
		traceId: string,
		parentTitlePath: string[],
		stepSpans: Span[],
		apiRequests: ApiRequestMatcher,
		inheritedPhase?: "before" | "after",
	) {
		// Playwright groups hook and fixture work into these lifecycle steps.
		// Use the category as well as the title to avoid classifying user steps.
		let phase = inheritedPhase;
		if (step.category === "hook") {
			if (step.title === "Before Hooks") phase = "before";
			if (step.title === "After Hooks" || step.title === "Worker Cleanup") {
				phase = "after";
			}
		}

		// Our own fixture's steps aren't the user's: leave them out, keeping
		// what ran inside them under the same parent.
		if (isInternalFixtureStep(step) || isInternalApiRequestStep(step)) {
			for (const childStep of step.steps ?? []) {
				this.processTestStep(
					childStep,
					parentSpanId,
					traceId,
					parentTitlePath,
					stepSpans,
					apiRequests,
					phase,
				);
			}
			return;
		}

		// Build the full title path for this step
		const currentTitlePath = [...parentTitlePath, step.title];

		const attributes: Record<string, string | number | boolean | string[]> = {};

		// Add step name (full path from test case to this step)
		attributes[ATTR_TEST_STEP_NAME] = currentTitlePath.join(" > ");

		// From 1.63, Playwright splits what a step did from what it acted on:
		// title `Click`, subtitle `getByRole('button')`, and reports the call's
		// arguments as params. Before that the locator is part of the title.
		attributes[ATTR_TEST_STEP_TITLE] = step.title;
		if (step.subtitle) attributes[ATTR_TEST_STEP_SUBTITLE] = step.subtitle;
		for (const [key, value] of Object.entries(step.params ?? {})) {
			const attributeValue = toStepParamAttribute(value);
			if (attributeValue !== undefined) {
				attributes[`${ATTR_TEST_STEP_PARAM_PREFIX}${key}`] = attributeValue;
			}
		}

		// Add step category
		attributes[ATTR_TEST_STEP_CATEGORY] = step.category;
		if (phase) attributes[ATTR_TEST_PHASE] = phase;

		// Add code location attributes if available. The column tells apart
		// the steps one line runs, such as the `Query count` and the
		// `Expect "toBe"` of `expect(await rows.count()).toBe(3)`.
		// A call on an `APIRequestContext` is also the HTTP client span of the
		// request it made. The fixture recorded how that went.
		const apiRequestCall = apiRequestStepCall(step);
		const apiRequest = apiRequestCall
			? apiRequests.take(step, apiRequestCall)
			: undefined;

		if (isApiRequestWrapperFile(step.location?.file)) {
			// Playwright didn't see past the fixture's wrapper. The fixture
			// recorded where the test made the call.
			if (apiRequest?.location) {
				attributes[ATTR_CODE_FILE_PATH] = apiRequest.location.file;
				attributes[ATTR_CODE_LINE_NUMBER] = apiRequest.location.line;
				attributes[ATTR_CODE_COLUMN_NUMBER] = apiRequest.location.column;
			}
		} else if (step.location) {
			const { file, line, column } = step.location;

			// Calculate relative path from rootDir
			const relativePath = this.rootDir
				? path.relative(this.rootDir, file)
				: file;

			attributes[ATTR_CODE_FILE_PATH] = relativePath;
			attributes[ATTR_CODE_LINE_NUMBER] = line;
			attributes[ATTR_CODE_COLUMN_NUMBER] = column;
		}

		const httpAttributes = apiRequest
			? capturedApiRequestAttributes(apiRequest)
			: apiRequestCall && apiRequestStepAttributes(apiRequestCall);
		Object.assign(attributes, httpAttributes);

		const stepSpan: Span = {
			traceId,
			// The ID the fixture sent in the request's traceparent header, so
			// the spans of the service that answered are this span's children.
			spanId: sentSpanId(apiRequest) ?? generateSpanId(),
			parentSpanId,
			name: TEST_STEP_SPAN_NAME,
			startTime: step.startTime,
			endTime: new Date(step.startTime.getTime() + step.duration),
			attributes,
		};
		if (httpAttributes) {
			stepSpan.kind = SPAN_KIND_CLIENT;
		}
		// The span's status stays the step's: an error response the test
		// expected doesn't fail the step.
		if (step.error) {
			stepSpan.status = errorStatus(step.error.message);
		}

		stepSpans.push(stepSpan);

		// Recursively process nested steps
		for (const childStep of step.steps ?? []) {
			this.processTestStep(
				childStep,
				stepSpan.spanId,
				traceId,
				currentTitlePath,
				stepSpans,
				apiRequests,
				phase,
			);
		}
	}

	onStdOut(chunk: string | Buffer, _test: TestCase, _result: TestResult): void {
		if (this.debug) {
			console.log(chunk.toString().slice(0, -1));
		}
	}
	onStdErr(chunk: string | Buffer, _test: TestCase, _result: TestResult): void {
		if (this.debug) {
			console.log(chunk.toString().slice(0, -1));
		}
	}

	printsToStdio(): boolean {
		return this.debug;
	}

	private async sendScreenshotsZipToTraceApi(params: {
		traceId: string;
		screenshotsZip: Blob;
		destination: ResolvedPlaywrightOpentelemetryDestination;
	}): Promise<void> {
		const { traceId, screenshotsZip, destination } = params;

		const screenshotUrl = `${destination.url}/playwright-otel-reporter/v1/screenshots.zip`;
		const response = await fetch(screenshotUrl, {
			method: "PUT",
			headers: {
				"content-type": "application/zip",
				"x-trace-id": traceId,
				...destination.headers,
				[PLAYWRIGHT_TRACE_API_SOURCE_HEADER]:
					PLAYWRIGHT_TRACE_API_SOURCE_REPORTER,
			},
			body: screenshotsZip,
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(
				`Failed to send screenshots ZIP: ${response.status} ${response.statusText}, ${error}`,
			);
		}
	}
}

/**
 * A test's screenshots. Playwright versions with a usable screencast only use
 * the frames the fixture captured; older versions only use
 * Playwright's trace. Never rejects: a test's spans are still sent without
 * its screenshots.
 */
async function readTestScreenshots(options: {
	config: ResolvedPlaywrightOpentelemetryConfig;
	playwrightVersion: string;
	screenshotsZip?: Buffer<ArrayBuffer>;
	traceAttachmentPath?: string;
}): Promise<ScreenshotResource[]> {
	if (!options.config.screenshots) {
		return [];
	}

	if (supportsScreencastScreenshots(options.playwrightVersion)) {
		if (!options.screenshotsZip) {
			return [];
		}
		try {
			return await readScreenshotsZip(new Blob([options.screenshotsZip]));
		} catch (error) {
			console.warn(
				`Failed to read the test's screenshots: ${error instanceof Error ? error.message : String(error)}`,
			);
			return [];
		}
	}

	// LEGACY: before SCREENCAST_SCREENSHOTS_MIN_PLAYWRIGHT_VERSION, screenshots
	// come from Playwright's trace. Remove with ./legacy once the peer
	// dependency requires that version.
	if (!options.traceAttachmentPath) {
		return [];
	}
	return Array.from(
		(
			await extractScreenshotsFromPlaywrightTrace(options.traceAttachmentPath)
		).values(),
	);
}

function getProjectPlaywrightOpentelemetryConfig(
	project: unknown,
): PlaywrightOpentelemetryConfig | undefined {
	return (project as { use?: PlaywrightOpentelemetryUseOptions } | undefined)
		?.use?.playwrightOpentelemetry;
}

function getTestConfig(test: TestCase): ResolvedPlaywrightOpentelemetryConfig {
	return resolvePlaywrightOpentelemetryConfig(
		getProjectPlaywrightOpentelemetryConfig(test.parent.project()),
		{ requireDestination: true },
	);
}

function getProjectOutputDir(test: TestCase): string | undefined {
	return (test.parent.project() as { outputDir?: string } | undefined)
		?.outputDir;
}

function getTestOutputDir(test: TestCase): string {
	const outputDir = getProjectOutputDir(test);
	if (!outputDir) {
		throw new Error(`No outputDir found for test "${test.id}"`);
	}
	return outputDir;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function addDestinationSpans(
	destinations: Map<string, SpanDestination>,
	spans: Span[],
	kind: SpanDestination["kind"],
	options: SendSpansOptions,
): void {
	const key = JSON.stringify(options);
	const destination = destinations.get(key);
	if (destination) {
		destination.spans.push(...spans);
		return;
	}

	destinations.set(key, { kind, spans: [...spans], options });
}

function hasTraceApiDestination(
	config: ResolvedPlaywrightOpentelemetryConfig,
): boolean {
	return config.playwrightTraceApiDestinations.some(
		(destination) => destination.url,
	);
}

function hasPlaywrightOpentelemetryDestination(
	config: ResolvedPlaywrightOpentelemetryConfig,
): boolean {
	return Boolean(
		config.storeTraceZip ||
		config.otlpDestinations.some((destination) => destination.url) ||
		config.playwrightTraceApiDestinations.some(
			(destination) => destination.url,
		),
	);
}

type FixtureData = {
	traceContext?: Buffer;
	fixtureSpans?: Buffer;
	apiRequests?: Buffer;
	screenshotsZip?: Buffer<ArrayBuffer>;
};

/**
 * A file the fixture left, or undefined when it left none. Handoff files are
 * optional; an attachment's file is not, so a missing one is reported.
 */
function readFixtureFile(
	filePath: string,
	options: { required?: boolean } = {},
): Buffer<ArrayBuffer> | undefined {
	try {
		return fsSync.readFileSync(filePath);
	} catch (error) {
		if (
			options.required ||
			(error as NodeJS.ErrnoException).code !== "ENOENT"
		) {
			console.warn(
				`Failed to read ${path.basename(filePath)} from the playwright-opentelemetry fixture: ${errorMessage(error)}`,
			);
		}
		return undefined;
	}
}

function parseTraceContext(
	body: Buffer | undefined,
	testId: string,
): { traceId: string; rootSpanId: string } {
	if (!body) {
		return { traceId: generateTraceId(), rootSpanId: generateSpanId() };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(body.toString("utf-8"));
	} catch (error) {
		throw new Error(
			`Invalid ${TRACE_CONTEXT_ATTACHMENT_NAME} for test ${testId}: ${error}`,
		);
	}

	if (!isTraceContextAttachment(parsed)) {
		throw new Error(
			`Invalid ${TRACE_CONTEXT_ATTACHMENT_NAME} for test ${testId}: expected { traceId, rootSpanId }`,
		);
	}

	return parsed;
}

function parseFixtureSpans(body: Buffer | undefined, testId: string): Span[] {
	if (!body) {
		return [];
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(body.toString("utf-8"));
	} catch (error) {
		throw new Error(
			`Invalid ${FIXTURE_SPANS_ATTACHMENT_NAME} for test ${testId}: ${error}`,
		);
	}

	if (!isRecord(parsed) || !Array.isArray(parsed.spans)) {
		throw new Error(
			`Invalid ${FIXTURE_SPANS_ATTACHMENT_NAME} for test ${testId}: expected { spans }`,
		);
	}

	return parsed.spans.map((span, index) =>
		parseFixtureSpan(span, testId, index),
	);
}

function parseFixtureSpan(value: unknown, testId: string, index: number): Span {
	if (!isRecord(value)) {
		throw invalidFixtureSpanError(testId, index);
	}

	const startTime = parseAttachmentDate(value.startTime);
	const endTime = parseAttachmentDate(value.endTime);
	if (
		typeof value.traceId !== "string" ||
		typeof value.spanId !== "string" ||
		typeof value.name !== "string" ||
		!startTime ||
		!endTime ||
		!isSpanAttributes(value.attributes) ||
		!isSpanEvents(value.events) ||
		(value.status !== undefined && !isSpanStatus(value.status))
	) {
		throw invalidFixtureSpanError(testId, index);
	}

	return {
		traceId: value.traceId,
		spanId: value.spanId,
		parentSpanId:
			typeof value.parentSpanId === "string" ? value.parentSpanId : undefined,
		name: value.name,
		startTime,
		endTime,
		attributes: value.attributes,
		events: value.events.map((event) => ({
			name: event.name,
			time: parseAttachmentDate(event.time)!,
			attributes: event.attributes,
		})),
		status: value.status,
		kind: typeof value.kind === "number" ? value.kind : undefined,
		serviceName:
			typeof value.serviceName === "string" ? value.serviceName : undefined,
	};
}

function invalidFixtureSpanError(testId: string, index: number): Error {
	return new Error(
		`Invalid ${FIXTURE_SPANS_ATTACHMENT_NAME} for test ${testId}: invalid span at index ${index}`,
	);
}

function parseAttachmentDate(value: unknown): Date | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

function isSpanStatus(value: unknown): value is NonNullable<Span["status"]> {
	return isRecord(value) && typeof value.code === "number";
}

const ANSI_ESCAPE_PATTERN =
	/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const ORPHANED_ANSI_SGR_PATTERN = /\[(?:\d{1,3};)*\d{1,3}m/g;

function errorStatus(message: string | undefined): NonNullable<Span["status"]> {
	if (!message) {
		return { code: 2 };
	}

	const cleanedMessage = cleanErrorMessage(message);
	return cleanedMessage ? { code: 2, message: cleanedMessage } : { code: 2 };
}

function cleanErrorMessage(message: string): string {
	return message
		.replace(ANSI_ESCAPE_PATTERN, "")
		.replace(ORPHANED_ANSI_SGR_PATTERN, "")
		.replace(/\r\n?/g, "\n")
		.trim();
}

function isInternalFixtureStep(step: TestStep): boolean {
	if (step.category !== "fixture" || !step.location?.file) {
		return false;
	}

	return isInternalFixtureFile(step.location.file);
}

/**
 * Earlier fixtures wrapped `request` in a Proxy, which made the fixture the
 * location of each call's step, and recorded the calls as spans of their own.
 * Their data can still arrive through `merge-reports`.
 */
function isInternalApiRequestStep(step: TestStep): boolean {
	if (!step.location?.file) {
		return false;
	}

	return (
		apiRequestStepCall(step) !== undefined &&
		isInternalFixtureFile(step.location.file)
	);
}

const SPAN_KIND_CLIENT = 3;

function capturedApiRequestAttributes(
	request: CapturedApiRequest,
): Span["attributes"] {
	return apiRequestHttpAttributes({
		method: request.method,
		url: request.responseUrl ?? request.url,
		statusCode: request.statusCode,
		responseHeaders: request.responseHeaders,
		errorType: request.errorType,
	});
}

/**
 * For a call the fixture didn't record, such as one made in a `beforeAll`
 * hook: what the step itself tells, from Playwright 1.63. There is no
 * response to report.
 */
function apiRequestStepAttributes(
	call: ApiRequestStepCall,
): Span["attributes"] | undefined {
	if (call.url === undefined || call.url.endsWith("…")) {
		return undefined;
	}
	return apiRequestHttpAttributes({
		// What Playwright sends when the test names no method.
		method: call.method ?? "GET",
		url: call.url,
	});
}

function unmatchedApiRequestSpan(
	request: CapturedApiRequest,
	options: { traceId: string; parentSpanId: string },
): Span {
	const startTime = new Date(request.startTime);
	const endTime = request.endTime ? new Date(request.endTime) : startTime;
	const attributes = capturedApiRequestAttributes(request);
	if (request.location) {
		attributes[ATTR_CODE_FILE_PATH] = request.location.file;
		attributes[ATTR_CODE_LINE_NUMBER] = request.location.line;
		attributes[ATTR_CODE_COLUMN_NUMBER] = request.location.column;
	}
	const failed =
		request.errorType !== undefined ||
		(request.statusCode !== undefined && request.statusCode >= 400);
	return {
		traceId: options.traceId,
		spanId: sentSpanId(request) ?? generateSpanId(),
		parentSpanId: options.parentSpanId,
		name: `HTTP ${request.method}`,
		kind: SPAN_KIND_CLIENT,
		startTime,
		endTime: Number.isNaN(endTime.getTime()) ? startTime : endTime,
		attributes,
		status: { code: failed ? 2 : 0 },
	};
}

function sentSpanId(
	request: CapturedApiRequest | undefined,
): string | undefined {
	return typeof request?.spanId === "string" &&
		/^[0-9a-f]{16}$/.test(request.spanId)
		? request.spanId
		: undefined;
}

function parseApiRequests(
	body: Buffer | undefined,
	testId: string,
): CapturedApiRequest[] {
	if (!body) {
		return [];
	}
	try {
		return parseApiRequestsHandoff(body.toString("utf-8"));
	} catch (error) {
		console.warn(
			`Ignoring invalid ${API_REQUESTS_ATTACHMENT_NAME} for test ${testId}: ${errorMessage(error)}`,
		);
		return [];
	}
}

/**
 * Span attributes hold primitives and string arrays, so other param values
 * (options objects, mixed arrays) are stored as JSON.
 */
function toStepParamAttribute(
	value: unknown,
): string | number | boolean | string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
		return value;
	}
	const json = JSON.stringify(value);
	// Values JSON can't describe, like a RegExp, come through as `{}`.
	return json === undefined || json === "{}" ? undefined : json;
}

function isInternalFixtureFile(filePath: string): boolean {
	const file = filePath.replace(/\\/g, "/");
	return INTERNAL_FIXTURE_FILE_PATTERNS.some((pattern) => pattern.test(file));
}

const INTERNAL_FIXTURE_FILE_PATTERNS = [
	/(?:^|\/)dist\/playwright-opentelemetry-fixture-[^/]+\.(?:mjs|cjs|js)$/,
	/(?:^|\/)dist\/fixture\.(?:mjs|cjs|js)$/,
	/(?:^|\/)playwright-opentelemetry\/dist\/fixture\.(?:mjs|cjs|js)$/,
	/(?:^|\/)playwright-opentelemetry\/reporter\/dist\/fixture\.(?:mjs|cjs|js)$/,
	/(?:^|\/)playwright-opentelemetry\/dist\/playwright-opentelemetry-fixture-[^/]+\.(?:mjs|cjs|js)$/,
	/(?:^|\/)playwright-opentelemetry\/dist\/fixture\/index\.(?:mjs|cjs|js)$/,
	/(?:^|\/)playwright-opentelemetry\/(?:reporter\/)?src\/fixture\/playwright-opentelemetry-fixture\.ts$/,
	/(?:^|\/)playwright-opentelemetry\/(?:reporter\/)?src\/fixture\/api-request-capture\.ts$/,
] as const;

function isSpanAttributes(value: unknown): value is Span["attributes"] {
	if (!isRecord(value)) {
		return false;
	}

	return Object.values(value).every(
		(attributeValue) =>
			typeof attributeValue === "string" ||
			typeof attributeValue === "number" ||
			typeof attributeValue === "boolean" ||
			(Array.isArray(attributeValue) &&
				attributeValue.every((item) => typeof item === "string")),
	);
}

function isSpanEvents(value: unknown): value is Array<{
	name: string;
	time: string;
	attributes?: Span["attributes"];
}> {
	return (
		Array.isArray(value) &&
		value.every(
			(event) =>
				isRecord(event) &&
				typeof event.name === "string" &&
				parseAttachmentDate(event.time) !== undefined &&
				(event.attributes === undefined || isSpanAttributes(event.attributes)),
		)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTraceContextAttachment(
	value: unknown,
): value is { traceId: string; rootSpanId: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"traceId" in value &&
		"rootSpanId" in value &&
		typeof value.traceId === "string" &&
		typeof value.rootSpanId === "string"
	);
}
