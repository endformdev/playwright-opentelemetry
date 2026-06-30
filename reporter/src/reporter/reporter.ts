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
	type SendSpansOptions,
	type Span,
} from "../shared/otel";
import { shouldRetainPlaywrightTrace } from "../shared/playwright-trace";
import {
	ATTR_CODE_FILE_PATH,
	ATTR_CODE_LINE_NUMBER,
	ATTR_TEST_CASE_NAME,
	ATTR_TEST_CASE_RESULT_STATUS,
	ATTR_TEST_CASE_TITLE,
} from "./otel-attributes";
import {
	ATTR_TEST_STEP_CATEGORY,
	ATTR_TEST_STEP_NAME,
	ATTR_TEST_STEP_TITLE,
	TEST_SPAN_NAME,
	TEST_STEP_SPAN_NAME,
} from "./reporter-attributes";
import { sendSpans } from "./sender";
import {
	createScreenshotsZip,
	createTraceZipBlob,
	extractScreenshotsFromPlaywrightTrace,
	type ScreenshotResource,
	writeTraceZip,
} from "./trace-zip-builder";

export type { Span } from "../shared/otel";

type SpanBatch = {
	spans: Span[];
	config: ResolvedPlaywrightOpentelemetryConfig;
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
	private rootDir?: string;
	private playwrightVersion?: string;
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
		const config = getTestConfig(test);
		const traceAttachment = result.attachments.find(
			(attachment) =>
				attachment.name === "trace" &&
				attachment.contentType === "application/zip" &&
				attachment.path,
		);
		const shouldProduceTrace =
			config.trace === null
				? Boolean(traceAttachment)
				: shouldRetainPlaywrightTrace(config.trace, {
						expectedStatus: test.expectedStatus,
						retry: result.retry,
						status: result.status,
					});
		if (!shouldProduceTrace) {
			return;
		}

		const testId = test.id;
		const outputDir = getTestOutputDir(test);
		const { traceId, rootSpanId: testSpanId } = readTraceContextAttachment(
			result,
			testId,
		);
		const fixtureSpans = config.storeTraceZip
			? readFixtureSpansAttachment(result, testId)
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
			const { file, line } = test.location;
			const relativePath = this.rootDir
				? path.relative(this.rootDir, file)
				: file;

			attributes[ATTR_CODE_FILE_PATH] = relativePath;
			attributes[ATTR_CODE_LINE_NUMBER] = line;
		}

		// Process test steps recursively first to collect all child spans
		// Track processed step IDs to merge duplicates (Playwright can report the same step twice,
		// once with location info and once without - we want to merge them)
		const processedSteps = new Map<string, Span>();
		const skippedStepIds = new Set<string>();
		if (result.steps && result.steps.length > 0) {
			for (const step of result.steps) {
				this.processTestStep(
					test,
					step,
					testSpanId,
					traceId,
					[],
					processedSteps,
					skippedStepIds,
				);
			}
		}

		const stepSpans = Array.from(processedSteps.values());

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
		this.spanBatches.push({ spans: testSpans, config });

		if (config.storeTraceZip || hasTraceApiDestination(config)) {
			const prepared = this.prepareTraceArtifact({
				test,
				spans: testSpans,
				fixtureSpans,
				traceAttachmentPath: traceAttachment?.path,
				traceId,
				config,
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

		const destinations = new Map<
			string,
			{ spans: Span[]; options: SendSpansOptions }
		>();

		for (const batch of this.spanBatches) {
			for (const destination of batch.config.otlpDestinations) {
				if (!destination.url) {
					continue;
				}

				addDestinationSpans(destinations, batch.spans, {
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

				addDestinationSpans(destinations, batch.spans, {
					tracesEndpoint: `${destination.url}/v1/traces`,
					headers: destination.headers,
					playwrightVersion: this.playwrightVersion || "unknown",
					debug: batch.config.debug,
				});
			}
		}

		for (const destination of destinations.values()) {
			await sendSpans(destination.spans, destination.options);
		}
	}

	private async prepareTraceArtifact(
		options: PrepareTraceArtifactOptions,
	): Promise<PreparedTraceArtifact> {
		const screenshots: Map<string, ScreenshotResource> =
			options.traceAttachmentPath
				? await extractScreenshotsFromPlaywrightTrace(
						options.traceAttachmentPath,
					)
				: new Map();

		const traceZipBlobPromise = options.config.storeTraceZip
			? createTraceZipBlob({
					test: options.test,
					spans: options.spans,
					fixtureSpans: options.fixtureSpans,
					playwrightVersion: options.playwrightVersion,
					screenshots,
				})
			: undefined;

		const uploadPromises = options.config.playwrightTraceApiDestinations
			.filter((destination) => destination.url)
			.map((destination) =>
				this.sendScreenshotsZipToTraceApi({
					traceId: options.traceId,
					screenshots,
					destination,
				}),
			);

		const [traceZipBlob] = await Promise.all([
			traceZipBlobPromise,
			...uploadPromises,
		]);

		return {
			traceZipBlob,
		};
	}

	private processTestStep(
		test: TestCase,
		step: TestStep,
		parentSpanId: string,
		traceId: string,
		parentTitlePath: string[],
		processedSteps: Map<string, Span>,
		skippedStepIds: Set<string>,
	) {
		const stepId = getStepId(test, step);

		// If this step is from our fixture file, mark it and remove any already-created span
		// (Playwright sometimes reports the same fixture twice, once without location first)
		if (isInternalFixtureStep(step)) {
			skippedStepIds.add(stepId);

			// Remove any span we already created for this stepId (from a duplicate without location)
			processedSteps.delete(stepId);

			// Still process nested steps with the same parent (skip this fixture as a span)
			if (step.steps && step.steps.length > 0) {
				for (const childStep of step.steps) {
					this.processTestStep(
						test,
						childStep,
						parentSpanId,
						traceId,
						parentTitlePath,
						processedSteps,
						skippedStepIds,
					);
				}
			}
			return;
		}

		// Skip if we've already identified this stepId as our fixture
		if (skippedStepIds.has(stepId)) {
			if (step.steps && step.steps.length > 0) {
				for (const childStep of step.steps) {
					this.processTestStep(
						test,
						childStep,
						parentSpanId,
						traceId,
						parentTitlePath,
						processedSteps,
						skippedStepIds,
					);
				}
			}
			return;
		}

		// Build the full title path for this step
		const currentTitlePath = [...parentTitlePath, step.title];

		// Check if we've already processed this step (Playwright can report duplicates)
		const existingSpan = processedSteps.get(stepId);
		if (existingSpan) {
			if (step.error) {
				existingSpan.status = errorStatus(step.error.message);
			}

			// Merge: if this step has location info and the existing one doesn't, add it
			if (step.location && !existingSpan.attributes[ATTR_CODE_FILE_PATH]) {
				const { file, line } = step.location;
				const relativePath = this.rootDir
					? path.relative(this.rootDir, file)
					: file;
				existingSpan.attributes[ATTR_CODE_FILE_PATH] = relativePath;
				existingSpan.attributes[ATTR_CODE_LINE_NUMBER] = line;
			}
			// Still need to process nested steps
			if (step.steps && step.steps.length > 0) {
				for (const childStep of step.steps) {
					this.processTestStep(
						test,
						childStep,
						existingSpan.spanId,
						traceId,
						currentTitlePath,
						processedSteps,
						skippedStepIds,
					);
				}
			}
			return;
		}

		const attributes: Record<string, string | number | boolean | string[]> = {};

		// Add step name (full path from test case to this step)
		attributes[ATTR_TEST_STEP_NAME] = currentTitlePath.join(" > ");

		// Add step title (just this step's title)
		attributes[ATTR_TEST_STEP_TITLE] = step.title;

		// Add step category
		attributes[ATTR_TEST_STEP_CATEGORY] = step.category;

		// Add code location attributes if available
		if (step.location) {
			const { file, line } = step.location;

			// Calculate relative path from rootDir
			const relativePath = this.rootDir
				? path.relative(this.rootDir, file)
				: file;

			attributes[ATTR_CODE_FILE_PATH] = relativePath;
			attributes[ATTR_CODE_LINE_NUMBER] = line;
		}

		const stepSpan: Span = {
			traceId,
			spanId: generateSpanId(),
			parentSpanId,
			name: TEST_STEP_SPAN_NAME,
			startTime: step.startTime,
			endTime: new Date(step.startTime.getTime() + step.duration),
			attributes,
		};
		if (step.error) {
			stepSpan.status = errorStatus(step.error.message);
		}

		processedSteps.set(stepId, stepSpan);

		// Recursively process nested steps
		if (step.steps && step.steps.length > 0) {
			for (const childStep of step.steps) {
				this.processTestStep(
					test,
					childStep,
					stepSpan.spanId,
					traceId,
					currentTitlePath,
					processedSteps,
					skippedStepIds,
				);
			}
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
		screenshots: Map<string, ScreenshotResource>;
		destination: ResolvedPlaywrightOpentelemetryDestination;
	}): Promise<void> {
		const { traceId, screenshots, destination } = params;
		const screenshotsZip = await createScreenshotsZip(screenshots);

		const screenshotUrl = `${destination.url}/playwright-otel-reporter/v1/screenshots.zip`;
		const response = await fetch(screenshotUrl, {
			method: "PUT",
			headers: {
				"content-type": "application/zip",
				"x-trace-id": traceId,
				...destination.headers,
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

function getTestOutputDir(test: TestCase): string {
	const outputDir = (
		test.parent.project() as { outputDir?: string } | undefined
	)?.outputDir;
	if (!outputDir) {
		throw new Error(`No outputDir found for test "${test.id}"`);
	}
	return outputDir;
}

function addDestinationSpans(
	destinations: Map<string, { spans: Span[]; options: SendSpansOptions }>,
	spans: Span[],
	options: SendSpansOptions,
): void {
	const key = JSON.stringify(options);
	const destination = destinations.get(key);
	if (destination) {
		destination.spans.push(...spans);
		return;
	}

	destinations.set(key, { spans: [...spans], options });
}

function hasTraceApiDestination(
	config: ResolvedPlaywrightOpentelemetryConfig,
): boolean {
	return config.playwrightTraceApiDestinations.some(
		(destination) => destination.url,
	);
}

function readTraceContextAttachment(
	result: TestResult,
	testId: string,
): { traceId: string; rootSpanId: string } {
	const attachment = result.attachments.find(
		(attachment) => attachment.name === TRACE_CONTEXT_ATTACHMENT_NAME,
	);

	if (!attachment?.body) {
		return { traceId: generateTraceId(), rootSpanId: generateSpanId() };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(attachment.body.toString("utf-8"));
	} catch (error) {
		throw new Error(
			`Invalid ${TRACE_CONTEXT_ATTACHMENT_NAME} attachment for test ${testId}: ${error}`,
		);
	}

	if (!isTraceContextAttachment(parsed)) {
		throw new Error(
			`Invalid ${TRACE_CONTEXT_ATTACHMENT_NAME} attachment for test ${testId}: expected { traceId, rootSpanId }`,
		);
	}

	return parsed;
}

function readFixtureSpansAttachment(
	result: TestResult,
	testId: string,
): Span[] {
	const attachment = result.attachments.find(
		(attachment) => attachment.name === FIXTURE_SPANS_ATTACHMENT_NAME,
	);

	if (!attachment?.body) {
		return [];
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(attachment.body.toString("utf-8"));
	} catch (error) {
		throw new Error(
			`Invalid ${FIXTURE_SPANS_ATTACHMENT_NAME} attachment for test ${testId}: ${error}`,
		);
	}

	if (!isRecord(parsed) || !Array.isArray(parsed.spans)) {
		throw new Error(
			`Invalid ${FIXTURE_SPANS_ATTACHMENT_NAME} attachment for test ${testId}: expected { spans }`,
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
		`Invalid ${FIXTURE_SPANS_ATTACHMENT_NAME} attachment for test ${testId}: invalid span at index ${index}`,
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

	const file = step.location.file.replace(/\\/g, "/");
	return INTERNAL_FIXTURE_FILE_PATTERNS.some((pattern) => pattern.test(file));
}

const INTERNAL_FIXTURE_FILE_PATTERNS = [
	/(?:^|\/)dist\/playwright-opentelemetry-fixture-[^/]+\.(?:mjs|cjs|js)$/,
	/(?:^|\/)playwright-opentelemetry\/dist\/fixture\.(?:mjs|cjs|js)$/,
	/(?:^|\/)playwright-opentelemetry\/dist\/playwright-opentelemetry-fixture-[^/]+\.(?:mjs|cjs|js)$/,
	/(?:^|\/)playwright-opentelemetry\/dist\/fixture\/index\.(?:mjs|cjs|js)$/,
	/(?:^|\/)playwright-opentelemetry\/(?:reporter\/)?src\/fixture\/playwright-opentelemetry-fixture\.ts$/,
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

function getStepId(test: TestCase, step: TestStep): string {
	// Include startTime to ensure uniqueness when steps have the same title
	// Without this, repeated steps like test.step("Click button", ...) would collide
	const startTimeMs = step.startTime.getTime();
	const id = [test.id, step.category, startTimeMs, ...step.titlePath()].join(
		" > ",
	);
	return id;
}
