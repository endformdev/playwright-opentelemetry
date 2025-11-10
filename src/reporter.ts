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
} from "./otel-attributes";
import {
	ATTR_TEST_STEP_CATEGORY,
	ATTR_TEST_STEP_NAME,
	TEST_SPAN_NAME,
	TEST_STEP_SPAN_NAME,
} from "./reporter-attributes";
import { sendSpans } from "./sender";

export interface PlaywrightOpentelemetryReporterOptions {
	tracesEndpoint: string;
	headers?: Record<string, string>;
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

	constructor(private options: PlaywrightOpentelemetryReporterOptions) {
		if (!options || !options.tracesEndpoint) {
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
			tracesEndpoint: this.options.tracesEndpoint,
			headers: this.options.headers,
			playwrightVersion: this.playwrightVersion || "unknown",
		});
	}

	onTestBegin(_test: TestCase) {}

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
				this.processTestStep(step, span.spanId, traceId);
			}
		}
	}

	private processTestStep(
		step: TestStep,
		parentSpanId: string,
		traceId: string,
	) {
		// Only create spans for test.step category
		if (step.category !== "test.step") {
			return;
		}

		const attributes: Record<string, string | number | boolean> = {};

		// Add step name and category
		attributes[ATTR_TEST_STEP_NAME] = step.title;
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
				this.processTestStep(childStep, stepSpan.spanId, traceId);
			}
		}
	}

	// printsToStdio(): boolean {
	// 	return false;
	// }
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

function getConfigurationErrorMessage(): string {
	return (
		`playwright-opentelemetry reporter requires options with 'tracesEndpoint' to be provided.\n\n` +
		`Example configuration in playwright.config.ts:\n\n` +
		`import { defineConfig } from '@playwright/test';\n` +
		`import type { PlaywrightOpentelemetryReporterOptions } from 'playwright-opentelemetry';\n\n` +
		`export default defineConfig({\n` +
		`  reporter: [\n` +
		`    [\n` +
		`      'playwright-opentelemetry',\n` +
		`      {\n` +
		`        tracesEndpoint: 'http://localhost:4317/v1/traces',\n` +
		`        headers: {\n` +
		`          Authorization: 'Bearer YOUR_TOKEN',\n` +
		`        },\n` +
		`      } satisfies PlaywrightOpentelemetryReporterOptions,\n` +
		`    ],\n` +
		`  ],\n` +
		`});\n`
	);
}
