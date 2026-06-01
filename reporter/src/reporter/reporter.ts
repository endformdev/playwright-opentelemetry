import { mkdirSync } from "node:fs";
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
	cleanupTestFiles,
	collectBrowserPageSpans,
	collectNetworkSpans,
	createNetworkDirs,
	generateSpanId,
	getOrCreateTraceId,
	PW_OTEL_DIR,
	writeCurrentSpanId,
} from "../shared/trace-files";
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
	createTraceZip,
	extractScreenshotsFromPlaywrightTrace,
} from "./trace-zip-builder";

export interface PlaywrightOpentelemetryReporterOptions {
	otlpEndpoint?: string;
	otlpHeaders?: Record<string, string>;
	playwrightTraceApiEndpoint?: string;
	playwrightTraceApiHeaders?: Record<string, string>;
	storeTraceZip?: boolean;
	serviceName?: string;
	debug?: boolean;
}

export type Span = {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	startTime: Date;
	endTime: Date;
	attributes: Record<string, string | number | boolean | string[]>;
	status: { code: number };
	kind?: number;
	/** Service name for this span (if different from default) */
	serviceName?: string;
};

export class PlaywrightOpentelemetryReporter implements Reporter {
	private spans: Span[] = [];
	private rootDir?: string;
	private playwrightVersion?: string;
	private resolvedEndpoint: string;
	private resolvedHeaders: Record<string, string>;
	private resolvedTraceApiEndpoint: string;
	private resolvedTraceApiHeaders: Record<string, string>;
	private resolvedServiceName: string;

	/** Maps test.id to its project's outputDir */
	private testOutputDirs: Map<string, string> = new Map();

	private testSpans: Map<string, string> = new Map();
	private testTraceIds: Map<string, string> = new Map();
	private stepSpanIds: Map<string, string> = new Map();

	/** Tracks the span context stack per test for append-only file writes */
	private spanContextStacks: Map<string, string[]> = new Map();

	constructor(private options: PlaywrightOpentelemetryReporterOptions = {}) {
		// Environment variables take priority over config options
		this.resolvedEndpoint =
			process.env.OTEL_EXPORTER_OTLP_ENDPOINT || options.otlpEndpoint || "";

		const envHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS
			? parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS)
			: {};
		this.resolvedHeaders = {
			...options.otlpHeaders,
			...envHeaders, // env headers override config headers
		};

		// Resolve trace API endpoint and headers
		this.resolvedTraceApiEndpoint = options.playwrightTraceApiEndpoint || "";
		this.resolvedTraceApiHeaders = options.playwrightTraceApiHeaders || {};

		this.resolvedServiceName =
			process.env.OTEL_SERVICE_NAME ||
			options.serviceName ||
			"playwright-tests";

		// Require either an OTLP endpoint, trace API endpoint, or storeTraceZip to be enabled
		if (
			!this.resolvedEndpoint &&
			!this.resolvedTraceApiEndpoint &&
			!this.options.storeTraceZip
		) {
			throw new Error(getConfigurationErrorMessage());
		}
	}

	onBegin(config: FullConfig, suite: Suite) {
		this.rootDir = config.rootDir;
		this.playwrightVersion = config.version;

		for (const test of suite.allTests()) {
			const project = test.parent.project();
			if (project?.outputDir) {
				this.testOutputDirs.set(test.id, project.outputDir);

				const otelDir = path.join(project.outputDir, PW_OTEL_DIR);
				mkdirSync(otelDir, { recursive: true });
			}
		}
	}

	onTestBegin(test: TestCase, result: TestResult) {
		const testId = test.id;
		const outputDir = this.getOutputDir(testId);

		const traceId = getOrCreateTraceId(outputDir, testId);
		this.testTraceIds.set(testId, traceId);

		const testSpanId = generateSpanId();
		this.testSpans.set(testId, testSpanId);

		// Initialize the span context stack with the test span ID
		this.spanContextStacks.set(testId, [testSpanId]);
		writeCurrentSpanId(outputDir, testId, testSpanId);

		createNetworkDirs(outputDir, testId);
	}

	async onStepBegin(test: TestCase, _result: TestResult, step: TestStep) {
		const testId = test.id;
		const outputDir = this.getOutputDir(testId);
		const stepId = getStepId(test, step);

		// Generate and track span ID for this step
		const stepSpanId = generateSpanId();
		this.stepSpanIds.set(stepId, stepSpanId);

		// Push step span ID onto internal stack and write to file
		const stack = this.spanContextStacks.get(testId);
		if (stack) {
			stack.push(stepSpanId);
			writeCurrentSpanId(outputDir, testId, stepSpanId);
		}
	}

	onStepEnd(test: TestCase, _result: TestResult, _step: TestStep) {
		const testId = test.id;
		const outputDir = this.getOutputDir(testId);

		// Pop from internal stack and write the new current parent to file
		const stack = this.spanContextStacks.get(testId);
		if (stack && stack.length > 1) {
			stack.pop();
			const currentParent = stack[stack.length - 1];
			writeCurrentSpanId(outputDir, testId, currentParent);
		}
	}

	async onTestEnd(test: TestCase, result: TestResult) {
		const testId = test.id;
		const outputDir = this.getOutputDir(testId);

		const traceId = this.testTraceIds.get(testId);
		const testSpanId = this.testSpans.get(testId);
		if (!traceId || !testSpanId) {
			throw new Error(`Test ${testId} not found`);
		}

		const traceAttachment = result.attachments.find(
			(attachment) =>
				attachment.name === "trace" &&
				attachment.contentType === "application/zip" &&
				attachment.path,
		);

		if (!traceAttachment?.path) {
			return;
		}

		// Attach trace ID early so other reporters can consume it during onTestEnd.
		result.attachments.push({
			name: "playwright-opentelemetry-trace-id",
			contentType: "text/plain",
			body: Buffer.from(traceId, "utf-8"),
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
		if (result.steps && result.steps.length > 0) {
			for (const step of result.steps) {
				this.processTestStep(
					test,
					step,
					testSpanId,
					traceId,
					[],
					processedSteps,
				);
			}
		}

		// Collect step spans (filter out marker objects used to track skipped steps)
		const stepSpans: Span[] = [];
		for (const [key, stepSpan] of processedSteps.entries()) {
			if (!key.startsWith("__skip__")) {
				stepSpans.push(stepSpan);
			}
		}

		// Collect browser page and network spans
		const networkSpans = await collectNetworkSpans(outputDir, testId);
		const reportedTestEndTime = new Date(
			result.startTime.getTime() + result.duration,
		);
		const browserPageSpans = await collectBrowserPageSpans(
			outputDir,
			testId,
			networkSpans,
			reportedTestEndTime,
		);

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

		// Expand bounds based on network spans
		for (const browserSpan of [...browserPageSpans, ...networkSpans]) {
			if (browserSpan.startTime < minStartTime) {
				minStartTime = browserSpan.startTime;
			}
			if (browserSpan.endTime > maxEndTime) {
				maxEndTime = browserSpan.endTime;
			}
		}

		const span: Span = {
			traceId,
			spanId: testSpanId,
			name: TEST_SPAN_NAME,
			startTime: minStartTime,
			endTime: maxEndTime,
			attributes,
			status: { code: result.status === test.expectedStatus ? 1 : 2 }, // 1=OK, 2=ERROR
		};

		// Build the final spans array with test span first
		const testSpans: Span[] = [
			span,
			...stepSpans,
			...browserPageSpans,
			...networkSpans,
		];

		// Add all test spans to the global spans array
		this.spans.push(...testSpans);

		// Calculate relative file path and duration for both zip and trace API
		const relativeFilePath =
			test.location && this.rootDir
				? path.relative(this.rootDir, test.location.file)
				: (test.location?.file ?? "");
		const computedDuration = maxEndTime.getTime() - minStartTime.getTime();

		// Extract screenshots from Playwright's retained trace ZIP.
		const screenshots = await extractScreenshotsFromPlaywrightTrace(
			traceAttachment.path,
		);

		// If storeTraceZip is enabled, create zip file for this test
		if (this.options.storeTraceZip) {
			await createTraceZip({
				outputDir,
				testId,
				test,
				spans: testSpans,
				serviceName: this.resolvedServiceName,
				playwrightVersion: this.playwrightVersion || "unknown",
				relativeFilePath,
				status: result.status,
				startTime: minStartTime,
				duration: computedDuration,
				screenshots,
			});
		}

		// If trace API is configured, send screenshots. Test metadata lives on the root span.
		if (this.resolvedTraceApiEndpoint) {
			await this.sendScreenshotsToTraceApi({
				traceId,
				screenshots,
			});
		}
	}

	async onEnd(_result: FullResult) {
		// Send spans to OTLP endpoint if configured
		if (this.resolvedEndpoint && this.spans.length > 0) {
			await sendSpans(this.spans, {
				tracesEndpoint: this.resolvedEndpoint,
				headers: this.resolvedHeaders,
				serviceName: this.resolvedServiceName,
				playwrightVersion: this.playwrightVersion || "unknown",
				debug: this.options.debug ?? false,
			});
		}

		// Send spans to trace API endpoint if configured
		if (this.resolvedTraceApiEndpoint && this.spans.length > 0) {
			await sendSpans(this.spans, {
				tracesEndpoint: `${this.resolvedTraceApiEndpoint}/v1/traces`,
				headers: this.resolvedTraceApiHeaders,
				serviceName: this.resolvedServiceName,
				playwrightVersion: this.playwrightVersion || "unknown",
				debug: this.options.debug ?? false,
			});
		}

		for (const [testId, outputDir] of this.testOutputDirs.entries()) {
			await cleanupTestFiles(outputDir, testId);
		}
	}

	private processTestStep(
		test: TestCase,
		step: TestStep,
		parentSpanId: string,
		traceId: string,
		parentTitlePath: string[],
		processedSteps: Map<string, Span>,
	) {
		// Skip fixture steps that come from the playwright-opentelemetry fixture file to avoid noise
		const isInternalFixture =
			step.category === "fixture" &&
			step.location?.file.includes("playwright-opentelemetry") &&
			(step.location?.file.endsWith("fixture.mjs") ||
				step.location?.file.endsWith("fixture/index.ts"));

		const stepId = getStepId(test, step);

		// If this step is from our fixture file, mark it and remove any already-created span
		// (Playwright sometimes reports the same fixture twice, once without location first)
		if (isInternalFixture) {
			processedSteps.set(`__skip__${stepId}`, {} as Span);

			// Remove any span we already created for this stepId (from a duplicate without location)
			if (processedSteps.has(stepId)) {
				processedSteps.delete(stepId);
			}

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
					);
				}
			}
			return;
		}

		// Skip if we've already identified this stepId as our fixture
		if (processedSteps.has(`__skip__${stepId}`)) {
			if (step.steps && step.steps.length > 0) {
				for (const childStep of step.steps) {
					this.processTestStep(
						test,
						childStep,
						parentSpanId,
						traceId,
						parentTitlePath,
						processedSteps,
					);
				}
			}
			return;
		}

		// Build the full title path for this step
		const currentTitlePath = [...parentTitlePath, step.title];

		// Use pre-generated span ID from state, or generate one if missing
		// (can happen due to race conditions with async hooks)
		const stepSpanId = this.stepSpanIds.get(stepId) ?? generateSpanId();

		// Check if we've already processed this step (Playwright can report duplicates)
		const existingSpan = processedSteps.get(stepId);
		if (existingSpan) {
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
			spanId: stepSpanId,
			parentSpanId,
			name: TEST_STEP_SPAN_NAME,
			startTime: step.startTime,
			endTime: new Date(step.startTime.getTime() + step.duration),
			attributes,
			status: { code: step.error ? 2 : 1 }, // 1=OK, 2=ERROR
		};

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
				);
			}
		}
	}

	onStdOut(chunk: string | Buffer, _test: TestCase, _result: TestResult): void {
		if (this.options.debug) {
			console.log(chunk.toString().slice(0, -1));
		}
	}
	onStdErr(chunk: string | Buffer, _test: TestCase, _result: TestResult): void {
		if (this.options.debug) {
			console.log(chunk.toString().slice(0, -1));
		}
	}

	printsToStdio(): boolean {
		return this.options.debug ?? false;
	}

	private getOutputDir(testId: string): string {
		const outputDir = this.testOutputDirs.get(testId);
		if (!outputDir) {
			throw new Error(
				`No outputDir found for test "${testId}" - onBegin must be called first and test must exist in suite`,
			);
		}
		return outputDir;
	}

	private async sendScreenshotsToTraceApi(params: {
		traceId: string;
		screenshots: Map<string, Blob>;
	}): Promise<void> {
		const { traceId, screenshots } = params;

		// Send screenshots concurrently
		await Promise.all(
			Array.from(screenshots.entries()).map(async ([filename, blob]) => {
				const screenshotUrl = `${this.resolvedTraceApiEndpoint}/playwright-otel-reporter/v1/screenshots/${filename}`;
				const response = await fetch(screenshotUrl, {
					method: "PUT",
					headers: {
						"content-type": "image/jpeg",
						"x-trace-id": traceId,
						...this.resolvedTraceApiHeaders,
					},
					body: blob,
				});

				if (!response.ok) {
					const error = await response.text();
					throw new Error(
						`Failed to send screenshot ${filename}: ${response.status} ${response.statusText}, ${error}`,
					);
				}
			}),
		);
	}
}

function parseOtlpHeaders(headersString: string): Record<string, string> {
	const headers: Record<string, string> = {};
	// Headers are comma-separated key=value pairs
	const pairs = headersString.split(",");
	for (const pair of pairs) {
		const [key, ...valueParts] = pair.split("=");
		if (key && valueParts.length > 0) {
			headers[key.trim()] = valueParts.join("=").trim();
		}
	}
	return headers;
}

function getConfigurationErrorMessage(): string {
	return (
		`playwright-opentelemetry reporter requires an OTLP endpoint to be configured.\n\n` +
		`You can configure it using environment variables:\n\n` +
		`  export OTEL_EXPORTER_OTLP_ENDPOINT="https://api.honeycomb.io"\n` +
		`  export OTEL_EXPORTER_OTLP_HEADERS="x-honeycomb-team=YOUR_API_KEY"\n` +
		`  export OTEL_SERVICE_NAME="my-service"\n\n` +
		`Or via playwright.config.ts:\n\n` +
		`import { defineConfig } from '@playwright/test';\n` +
		`import type { PlaywrightOpentelemetryReporterOptions } from 'playwright-opentelemetry';\n\n` +
		`export default defineConfig({\n` +
		`  reporter: [\n` +
		`    [\n` +
		`      'playwright-opentelemetry/reporter',\n` +
		`      {\n` +
		`        otlpEndpoint: 'http://localhost:4317/v1/traces',\n` +
		`        otlpHeaders: {\n` +
		`          Authorization: 'Bearer YOUR_TOKEN',\n` +
		`        },\n` +
		`        serviceName: 'my-service',\n` +
		`      } satisfies PlaywrightOpentelemetryReporterOptions,\n` +
		`    ],\n` +
		`  ],\n` +
		`});\n\n` +
		`Note: Environment variables take precedence over config file options.\n`
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
