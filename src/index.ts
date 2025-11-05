import type {
	FullResult,
	Reporter,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";

export default class PlaywrightOpentelemetryReporter implements Reporter {
	onEnd(result: FullResult) {
		console.log(result);
	}

	onTestBegin(test: TestCase) {
		console.log(test.title);
	}

	onTestEnd(test: TestCase, result: TestResult) {
		console.log(test.title, result.status);
	}
}
