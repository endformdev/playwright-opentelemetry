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

	constructor(private options?: PlaywrightOpentelemetryReporterOptions) {}

	onEnd(_result: FullResult) {
		sendSpans(this.spans, {
			endpoint:
				this.options?.opentelemetryTracesEndpoint ||
				"http://localhost:4318/v1/traces",
		});
	}

	onTestBegin(test: TestCase) {
		// Store start time for this test
	}

	onTestEnd(test: TestCase, result: TestResult) {
		const span: Span = {
			traceId: this.generateTraceId(),
			spanId: this.generateSpanId(),
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

	private generateTraceId(): string {
		return Array.from({ length: 32 }, () =>
			Math.floor(Math.random() * 16).toString(16),
		).join("");
	}

	private generateSpanId(): string {
		return Array.from({ length: 16 }, () =>
			Math.floor(Math.random() * 16).toString(16),
		).join("");
	}
}
