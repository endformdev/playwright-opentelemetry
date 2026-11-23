import type {
	FullResult,
	Reporter,
	TestCase,
	TestResult,
	TestStep,
} from "@playwright/test/reporter";

const TEST_NAME = "native Playwright request fixture trace";
const SPEC_FILE = "native-api-request-spans.spec.ts";
const REQUESTS = 6;

/**
 * The fixture wraps `APIRequestContext` methods. Fails the run if Playwright
 * itself, and so its HTML report, UI mode and trace, no longer says a request
 * was made from the test's own line.
 */
export default class RequestStepLocationReporter implements Reporter {
	private problems: string[] = [];

	onTestEnd(test: TestCase, result: TestResult): void {
		if (test.title !== TEST_NAME || result.status !== "passed") {
			return;
		}

		const steps = requestSteps(result.steps);
		if (steps.length !== REQUESTS) {
			this.problems.push(
				`expected ${REQUESTS} request steps, found ${steps.length}`,
			);
		}
		const lines = new Set<number>();
		for (const step of steps) {
			if (!step.location?.file.endsWith(SPEC_FILE)) {
				this.problems.push(
					`"${step.title}" is located in ${step.location?.file ?? "no file"}`,
				);
				continue;
			}
			lines.add(step.location.line);
		}
		if (this.problems.length === 0 && lines.size !== REQUESTS) {
			this.problems.push(
				`expected the request steps on ${REQUESTS} different lines, found ${lines.size}`,
			);
		}
	}

	async onEnd(): Promise<{ status?: FullResult["status"] } | undefined> {
		if (this.problems.length === 0) {
			return undefined;
		}
		console.error(
			`Playwright's request steps don't point at the test:\n${this.problems.join("\n")}`,
		);
		return { status: "failed" };
	}

	printsToStdio(): boolean {
		return false;
	}
}

function requestSteps(steps: TestStep[]): TestStep[] {
	return steps.flatMap((step) => [
		...(step.category === "pw:api" &&
		typeof step.params?.url === "string" &&
		typeof step.params.method === "string"
			? [step]
			: []),
		...requestSteps(step.steps),
	]);
}
