import path from "node:path";
import type {
	FullConfig,
	FullResult,
	Reporter,
	Suite,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";
import {
	ATTR_CODE_COLUMN,
	ATTR_CODE_FILEPATH,
	ATTR_CODE_LINENO,
} from "./attributes";
import type { PlaywrightOpentelemetryReporterOptions } from "./options";
import { sendSpans } from "./sender";

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

	constructor(private options: PlaywrightOpentelemetryReporterOptions) {
		if (!options || !options.tracesEndpoint) {
			throw new Error(getConfigurationErrorMessage());
		}
	}

	onBegin(config: FullConfig, _suite: Suite) {
		// Store rootDir for calculating relative paths
		this.rootDir = config.rootDir;
	}

	async onEnd(_result: FullResult) {
		await sendSpans(this.spans, {
			tracesEndpoint: this.options.tracesEndpoint,
			headers: this.options.headers,
		});
	}

	onTestBegin(test: TestCase) {
		// Store start time for this test
	}

	onTestEnd(test: TestCase, result: TestResult) {
		const attributes: Record<string, string | number | boolean> = {
			"test.status": result.status,
		};

		// Add code location attributes if available
		if (test.location) {
			const { file, line, column } = test.location;

			// Calculate relative path from rootDir
			const relativePath = this.rootDir
				? path.relative(this.rootDir, file)
				: file;

			attributes[ATTR_CODE_FILEPATH] = relativePath;
			attributes[ATTR_CODE_LINENO] = line;
			attributes[ATTR_CODE_COLUMN] = column;
		}

		const span: Span = {
			traceId: generateTraceId(),
			spanId: generateSpanId(),
			name: test.title,
			startTime: result.startTime,
			endTime: new Date(result.startTime.getTime() + result.duration),
			attributes,
			status: { code: result.status === "passed" ? 1 : 2 }, // 1=OK, 2=ERROR
		};

		this.spans.push(span);
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
