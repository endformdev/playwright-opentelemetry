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
	kind: number;
	startTimeUnixNano: string;
	endTimeUnixNano: string;
	attributes: Array<{
		key: string;
		value: { stringValue?: string; intValue?: number; boolValue?: boolean };
	}>;
	status: { code: number };
};

export class PlaywrightOpentelemetryReporter implements Reporter {
	private spans: Span[] = [];

	constructor(private options: PlaywrightOpentelemetryReporterOptions) {
		console.log("options", options);
		this.options = options;
	}

	onEnd(_result: FullResult) {
		sendSpans(this.spans);
	}

	onTestBegin(test: TestCase) {
		// Store start time for this test
	}

	onTestEnd(test: TestCase, result: TestResult) {
		const span: Span = {
			traceId: this.generateTraceId(),
			spanId: this.generateSpanId(),
			name: test.title,
			kind: 1, // SPAN_KIND_INTERNAL
			startTimeUnixNano: String(result.startTime.getTime() * 1_000_000),
			endTimeUnixNano: String(
				(result.startTime.getTime() + result.duration) * 1_000_000,
			),
			attributes: [
				{ key: "test.status", value: { stringValue: result.status } },
			],
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
