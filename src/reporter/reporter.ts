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
};

export class PlaywrightOpentelemetryReporter implements Reporter {
	private spans: Span[] = [];
	private rootDir?: string;
	private playwrightVersion?: string;
	private resolvedEndpoint: string;
	private resolvedHeaders: Record<string, string>;
	private resolvedServiceName: string;

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

	onBegin(config: FullConfig, _suite: Suite) {
		// Store rootDir for calculating relative paths
		this.rootDir = config.rootDir;
		// Store Playwright version for service.version attribute
		this.playwrightVersion = config.version;
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

	onTestBegin(_test: TestCase) {}

	onStepBegin(_test: TestCase, _result: TestResult, _step: TestStep) {}

	onStepEnd(_test: TestCase, _result: TestResult, _step: TestStep) {}

	onTestEnd(test: TestCase, result: TestResult) {
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

		const traceId = generateTraceId();
		const span: Span = {
			traceId,
			spanId: generateSpanId(),
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
				this.processTestStep(step, span.spanId, traceId, []);
			}
		}
	}

	private processTestStep(
		step: TestStep,
		parentSpanId: string,
		traceId: string,
		parentTitlePath: string[],
	) {
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

		const stepSpan: Span = {
			traceId,
			spanId: generateSpanId(),
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

	printsToStdio(): boolean {
		return this.options.debug ?? false;
	}
}

function generateTraceId(): string {
	return Array.from({ length: 32 }, () =>
		Math.floor(Math.random() * 16).toString(16),
	).join("");
}

function generateSpanId(): string {
	return Array.from({ length: 16 }, () =>
		Math.floor(Math.random() * 16).toString(16),
	).join("");
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
