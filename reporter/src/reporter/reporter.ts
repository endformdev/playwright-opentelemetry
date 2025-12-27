import { existsSync, type FSWatcher, mkdirSync, watch } from "node:fs";
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
	collectNetworkSpans,
	copyScreenshotForTest,
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
import { createTraceZip } from "./trace-zip-builder";

export interface PlaywrightOpentelemetryReporterOptions {
	otlpEndpoint?: string;
	otlpHeaders?: Record<string, string>;
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
	attributes: Record<string, string | number | boolean>;
	status: { code: number };
	kind?: number;
};

export class PlaywrightOpentelemetryReporter implements Reporter {
	private spans: Span[] = [];
	private rootDir?: string;
	private playwrightVersion?: string;
	private resolvedEndpoint: string;
	private resolvedHeaders: Record<string, string>;
	private resolvedServiceName: string;

	/** Maps test.id to its project's outputDir */
	private testOutputDirs: Map<string, string> = new Map();

	/** File system watchers for output directories */
	private directoryWatchers: FSWatcher[] = [];

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

		this.resolvedServiceName =
			process.env.OTEL_SERVICE_NAME ||
			options.serviceName ||
			"playwright-tests";

		// Require either an OTLP endpoint or storeTraceZip to be enabled
		if (!this.resolvedEndpoint && !this.options.storeTraceZip) {
			throw new Error(getConfigurationErrorMessage());
		}
	}

	onBegin(config: FullConfig, suite: Suite) {
		this.rootDir = config.rootDir;
		this.playwrightVersion = config.version;

		// Track unique directories to avoid duplicate watchers
		const watchedDirs = new Set<string>();

		for (const test of suite.allTests()) {
			const project = test.parent.project();
			if (project?.outputDir) {
				this.testOutputDirs.set(test.id, project.outputDir);

				const otelDir = path.join(project.outputDir, PW_OTEL_DIR);
				mkdirSync(otelDir, { recursive: true });

				// Set up file watcher to copy screenshots to test-specific directories
				if (this.options.storeTraceZip && !watchedDirs.has(project.outputDir)) {
					watchedDirs.add(project.outputDir);
					const watcher = watch(
						project.outputDir,
						{ recursive: true },
						(_eventType, filename) => {
							if (
								!filename ||
								(!filename.endsWith(".jpg") && !filename.endsWith(".jpeg"))
							) {
								return;
							}

							const sourcePath = path.join(project.outputDir, filename);
							if (!existsSync(sourcePath)) {
								return;
							}

							// Extract pageGuid from filename: {pageGuid}-{timestamp}.jpeg
							// e.g., page@f06f11f7c14d6ce1060d47d79f05c154-1766833384425.jpeg
							const basename = path.basename(filename);
							const lastDashIndex = basename.lastIndexOf("-");

							if (lastDashIndex === -1) {
								return;
							}

							const pageGuid = basename.slice(0, lastDashIndex);

							try {
								copyScreenshotForTest(
									project.outputDir,
									pageGuid,
									sourcePath,
									basename,
								);
							} catch (_err) {
								// Ignore copy errors - screenshot may have been deleted
							}
						},
					);
					this.directoryWatchers.push(watcher);
				}
			}
		}
	}

	onTestBegin(test: TestCase) {
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

		const attributes: Record<string, string | number | boolean> = {};

		// titlePath format: ['', 'project', 'filename', ...describes, 'testname']
		// We want: [...describes, 'testname'] joined with ' > '
		const titlePath = test.titlePath();
		if (titlePath.length >= 3) {
			// Skip root (''), project name, and filename to get describes and test name
			const caseName = titlePath.slice(3).join(" > ");
			attributes[ATTR_TEST_CASE_NAME] = caseName;
		}

		attributes[ATTR_TEST_CASE_TITLE] = test.title;
		attributes[ATTR_TEST_CASE_RESULT_STATUS] = result.status;

		if (test.location) {
			const { file, line } = test.location;
			const relativePath = this.rootDir
				? path.relative(this.rootDir, file)
				: file;

			attributes[ATTR_CODE_FILE_PATH] = relativePath;
			attributes[ATTR_CODE_LINE_NUMBER] = line;
		}

		const span: Span = {
			traceId,
			spanId: testSpanId,
			name: TEST_SPAN_NAME,
			startTime: result.startTime,
			endTime: new Date(result.startTime.getTime() + result.duration),
			attributes,
			status: { code: result.status === test.expectedStatus ? 1 : 2 }, // 1=OK, 2=ERROR
		};

		const testSpans: Span[] = [span];
		// Process test steps recursively
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

		// Add processed step spans to this test's spans
		// Filter out marker objects used to track skipped steps (they have keys starting with __skip__)
		for (const [key, stepSpan] of processedSteps.entries()) {
			if (!key.startsWith("__skip__")) {
				testSpans.push(stepSpan);
			}
		}

		const networkSpans = await collectNetworkSpans(outputDir, testId);
		for (const networkSpan of networkSpans) {
			testSpans.push(networkSpan);
		}

		// Add all test spans to the global spans array
		this.spans.push(...testSpans);

		// If storeTraceZip is enabled, create zip file for this test
		if (this.options.storeTraceZip) {
			await createTraceZip({
				outputDir,
				testId,
				test,
				spans: testSpans,
				serviceName: this.resolvedServiceName,
				playwrightVersion: this.playwrightVersion || "unknown",
			});
		}
	}

	async onEnd(_result: FullResult) {
		// Close all directory watchers
		for (const watcher of this.directoryWatchers) {
			watcher.close();
		}
		this.directoryWatchers = [];

		// Only send spans if an endpoint is configured
		if (this.resolvedEndpoint) {
			await sendSpans(this.spans, {
				tracesEndpoint: this.resolvedEndpoint,
				headers: this.resolvedHeaders,
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
			const existingSpan = processedSteps.get(stepId);
			if (existingSpan) {
				const spanIndex = this.spans.indexOf(existingSpan);
				if (spanIndex !== -1) {
					this.spans.splice(spanIndex, 1);
				}
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

		const attributes: Record<string, string | number | boolean> = {};

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

		this.spans.push(stepSpan);
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

	/**
	 * Get the output directory for a test ID.
	 * Throws if the test ID was not registered in onBegin.
	 */
	private getOutputDir(testId: string): string {
		const outputDir = this.testOutputDirs.get(testId);
		if (!outputDir) {
			throw new Error(
				`No outputDir found for test "${testId}" - onBegin must be called first and test must exist in suite`,
			);
		}
		return outputDir;
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
