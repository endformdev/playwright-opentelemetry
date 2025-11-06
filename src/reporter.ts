import type {
	FullResult,
	Reporter,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";
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

	constructor(private options: PlaywrightOpentelemetryReporterOptions) {
		if (!options || !options.tracesEndpoint) {
			throw new Error(getConfigurationErrorMessage());
		}
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
		const span: Span = {
			traceId: generateTraceId(),
			spanId: generateSpanId(),
			name: test.title,
			startTime: result.startTime,
			endTime: new Date(result.startTime.getTime() + result.duration),
			attributes: {
				"test.status": result.status,
			},
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
