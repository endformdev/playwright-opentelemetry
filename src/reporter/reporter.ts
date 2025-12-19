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
	collectNetworkSpans,
	createNetworkDirs,
	generateSpanId,
	getOrCreateTraceId,
	OTEL_DIR,
	popSpanContext,
	pushSpanContext,
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

export interface PlaywrightOpentelemetryReporterOptions {
	otlpEndpoint?: string;
	otlpHeaders?: Record<string, string>;
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

	private testSpans: Map<string, string> = new Map();
	private testTraceIds: Map<string, string> = new Map();
	private stepSpanIds: Map<string, string> = new Map();

	constructor(private options: PlaywrightOpentelemetryReporterOptions = {}) {
		// Resolve configuration with environment variable precedence
		// Environment variables take priority over config options
		this.resolvedEndpoint =
			process.env.OTEL_EXPORTER_OTLP_ENDPOINT || options.otlpEndpoint || "";

		// Parse headers from environment variable if present
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

		if (!this.resolvedEndpoint) {
			throw new Error(getConfigurationErrorMessage());
		}
	}

	onBegin(config: FullConfig, suite: Suite) {
		// Store rootDir for calculating relative paths
		this.rootDir = config.rootDir;
		// Store Playwright version for service.version attribute
		this.playwrightVersion = config.version;

		// Build map of test IDs to their project's outputDir
		for (const test of suite.allTests()) {
			const project = test.parent.project();
			if (project?.outputDir) {
				mkdirSync(path.join(project.outputDir, OTEL_DIR), { recursive: true });
				this.testOutputDirs.set(test.id, project.outputDir);
			}
		}
	}

	onTestBegin(test: TestCase) {
		console.log(`onTestBegin: ${Date.now()}`);
		const testId = test.id;
		const outputDir = this.getOutputDir(testId);

		const traceId = getOrCreateTraceId(outputDir, testId);
		this.testTraceIds.set(testId, traceId);

		const testSpanId = generateSpanId();
		this.testSpans.set(testId, testSpanId);
		pushSpanContext(outputDir, testId, testSpanId);

		createNetworkDirs(outputDir, testId);
	}

	async onStepBegin(test: TestCase, _result: TestResult, step: TestStep) {
		console.log(`onStepBegin: ${step.title} ${step.category} ${Date.now()}`);
		const testId = test.id;
		const outputDir = this.getOutputDir(testId);
		const stepId = getStepId(test, step);

		// Generate and track span ID for this step
		const stepSpanId = generateSpanId();
		this.stepSpanIds.set(stepId, stepSpanId);

		// Push step span context so fixture can read current parent span id
		pushSpanContext(outputDir, testId, stepSpanId);
	}

	onStepEnd(test: TestCase, _result: TestResult, _step: TestStep) {
		const testId = test.id;
		const outputDir = this.getOutputDir(testId);
		popSpanContext(outputDir, testId);
	}

	async onTestEnd(test: TestCase, result: TestResult) {
		console.log(`onTestEnd: ${Date.now()}`);
		const testId = test.id;
		const outputDir = this.getOutputDir(testId);

		const traceId = this.testTraceIds.get(testId);
		const testSpanId = this.testSpans.get(testId);
		if (!traceId || !testSpanId) {
			throw new Error(`Test ${testId} not found`);
		}

		const attributes: Record<string, string | number | boolean> = {};

		// Add test case name from titlePath
		// titlePath format: ['', 'project', 'filename', ...describes, 'testname']
		// We want: [...describes, 'testname'] joined with ' > '
		const titlePath = test.titlePath();
		if (titlePath.length >= 3) {
			// Skip root (''), project name, and filename to get describes and test name
			const caseName = titlePath.slice(3).join(" > ");
			attributes[ATTR_TEST_CASE_NAME] = caseName;
		}

		// Add test case title (just the test name)
		attributes[ATTR_TEST_CASE_TITLE] = test.title;

		// Add test case result status
		attributes[ATTR_TEST_CASE_RESULT_STATUS] = result.status;

		// Add code location attributes if available
		if (test.location) {
			const { file, line } = test.location;

			// Calculate relative path from rootDir
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

		this.spans.push(span);

		// Process test steps recursively
		if (result.steps && result.steps.length > 0) {
			for (const step of result.steps) {
				this.processTestStep(step, testSpanId, traceId, []);
			}
		}

		// Collect network spans from fixture - no reparenting, use as-is
		const networkSpans = await collectNetworkSpans(outputDir, testId);
		for (const networkSpan of networkSpans) {
			this.spans.push(networkSpan);
		}

		// Cleanup trace files for this test
		await cleanupTestFiles(outputDir, testId);
	}

	async onEnd(_result: FullResult) {
		await sendSpans(this.spans, {
			tracesEndpoint: this.resolvedEndpoint,
			headers: this.resolvedHeaders,
			serviceName: this.resolvedServiceName,
			playwrightVersion: this.playwrightVersion || "unknown",
			debug: this.options.debug ?? false,
		});
	}

	private processTestStep(
		step: TestStep,
		parentSpanId: string,
		traceId: string,
		parentTitlePath: string[],
	) {
		console.log(
			`processTestStep: ${step.title} ${step.category} ${Date.now()}`,
		);
		const attributes: Record<string, string | number | boolean> = {};

		// Build the full title path for this step
		const currentTitlePath = [...parentTitlePath, step.title];

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

		// Use pre-generated span ID from state, or generate one if missing
		// (can happen due to race conditions with async hooks)
		const stepSpanId = generateSpanId();

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

		// Recursively process nested steps
		if (step.steps && step.steps.length > 0) {
			for (const childStep of step.steps) {
				this.processTestStep(
					childStep,
					stepSpan.spanId,
					traceId,
					currentTitlePath,
				);
			}
		}
	}

	onStdOut(chunk: string | Buffer, _test: TestCase, _result: TestResult): void {
		// log without last new line
		console.log(chunk.toString().slice(0, -1));
	}
	onStdErr(chunk: string | Buffer, _test: TestCase, _result: TestResult): void {
		console.log(chunk.toString().slice(0, -1));
	}

	printsToStdio(): boolean {
		return true;
		// return this.options.debug ?? false;
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
	const id = [test.id, step.category, ...step.titlePath()].join(" > ");
	return id;
}
