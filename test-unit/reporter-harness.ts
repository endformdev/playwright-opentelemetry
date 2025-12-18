import type {
	FullConfig,
	FullResult,
	Suite,
	TestCase,
	TestResult,
	TestStep,
} from "@playwright/test/reporter";
import { playwrightFixturePropagator } from "../src/fixture/network-propagator";
import type { PlaywrightOpentelemetryReporterOptions } from "../src/reporter";
import PlaywrightOpentelemetryReporter from "../src/reporter";

export interface TestHarnessOptions {
	reporterOptions?: Partial<PlaywrightOpentelemetryReporterOptions>;
	config?: ConfigDefinition;
	test: TestDefinition;
	result?: ResultDefinition;
}

export interface ConfigDefinition {
	rootDir?: string;
	version?: string;
}

export interface TestDefinition {
	title: string;
	titlePath?: string[];
	expectedStatus?: "passed" | "failed" | "skipped" | "timedOut";
	location?: {
		file: string;
		line: number;
		column?: number;
	};
}

export interface ResultDefinition {
	status?: "passed" | "failed" | "skipped" | "timedOut" | "interrupted";
	startTime?: Date;
	duration?: number;
	steps?: StepDefinition[];
}

export interface NetworkAction {
	/** HTTP request method (GET, POST, etc.) - Required */
	method: string;
	/** Absolute URL - Required */
	url: string;
	/** Server domain name - Required (extracted from URL if not provided) */
	serverAddress?: string;
	/** Server port number - Required (extracted from URL if not provided) */
	serverPort?: number;
	/** HTTP response status code - Conditionally Required if response received */
	statusCode?: number;
	/** Error type if request failed - Conditionally Required if request ended with error */
	errorType?: string;
	startTime?: Date;
	duration?: number;
}

export interface StepDefinition {
	title: string;
	category?: string;
	startTime?: Date;
	duration?: number;
	steps?: StepDefinition[];
	error?: { message: string; stack?: string };
	location?: {
		file: string;
		line: number;
		column?: number;
	};
	networkActions?: NetworkAction[];
}

export const DEFAULT_ROOT_DIR = "/Users/test/project/test-e2e";
export const DEFAULT_VERSION = "1.56.1";
export const DEFAULT_START_TIME = new Date("2025-11-06T10:00:00.000Z");
const DEFAULT_DURATION = 1000;
const DEFAULT_STEP_DURATION = 100;
const DEFAULT_STEP_CATEGORY = "test.step";

export const DEFAULT_REPORTER_OPTIONS: PlaywrightOpentelemetryReporterOptions =
	{
		otlpEndpoint: "http://localhost:4317/v1/traces",
		debug: true,
	};

// Re-export for convenience in tests
export { PlaywrightOpentelemetryReporter, playwrightFixturePropagator };
export type { FullConfig, FullResult, Suite, TestCase, TestResult };

/**
 * Runs a reporter test with the given options, executing all hooks in the correct order.
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * await runReporterTest({
 *   test: { title: "should login" },
 * });
 *
 * // With steps
 * await runReporterTest({
 *   test: { title: "test with steps" },
 *   result: {
 *     steps: [
 *       { title: "Step 1" },
 *       { title: "Step 2", steps: [{ title: "Nested" }] },
 *     ],
 *   },
 * });
 *
 * // Custom config
 * await runReporterTest({
 *   config: { rootDir: "/custom/path" },
 *   test: { title: "my test", location: { file: "/custom/path/test.spec.ts", line: 10 } },
 * });
 * ```
 */
export async function runReporterTest({
	reporterOptions,
	config,
	test,
	result,
}: TestHarnessOptions): Promise<TestHarnessResult> {
	// Merge reporter options with defaults
	const mergedReporterOptions: PlaywrightOpentelemetryReporterOptions = {
		...DEFAULT_REPORTER_OPTIONS,
		...reporterOptions,
	};

	// Create reporter
	const reporter = new PlaywrightOpentelemetryReporter(mergedReporterOptions);

	// Build mock objects
	const mergedConfig = buildConfig(config);
	const testCase = buildTestCase(test);
	const testResult = buildTestResult(result, DEFAULT_START_TIME);

	// Execute hooks in order
	reporter.onBegin(mergedConfig, {} as Suite);
	reporter.onTestBegin(testCase);

	// Execute step hooks (depth-first: begin -> nested -> end)
	if (testResult.steps && testResult.steps.length > 0) {
		await executeStepHooks(
			reporter,
			testCase,
			testResult,
			testResult.steps,
			result?.steps ?? [],
		);
	}

	reporter.onTestEnd(testCase, testResult);
	await reporter.onEnd({} as FullResult);

	return { reporter };
}

/**
 * Creates a mock Playwright Route object for testing the fixture propagator
 */
export function createMockRoute(method: string, url: string) {
	return {
		request: () => ({
			url: () => url,
			method: () => method,
		}),
		continue: async () => {},
	} as Parameters<typeof playwrightFixturePropagator>[0]["route"];
}

export function buildConfig(def?: ConfigDefinition): FullConfig {
	return {
		rootDir: def?.rootDir ?? DEFAULT_ROOT_DIR,
		version: def?.version ?? DEFAULT_VERSION,
	} as FullConfig;
}

export function buildTestCase(def: TestDefinition): TestCase {
	const titlePath = def.titlePath ?? [
		"",
		"chromium",
		"test.spec.ts",
		def.title,
	];

	return {
		title: def.title,
		titlePath: () => titlePath,
		expectedStatus: def.expectedStatus ?? "passed",
		location: def.location
			? {
					file: def.location.file,
					line: def.location.line,
					column: def.location.column ?? 1,
				}
			: undefined,
	} as TestCase;
}

export function buildTestResult(
	def: ResultDefinition | undefined,
	testStartTime: Date = DEFAULT_START_TIME,
): TestResult {
	const startTime = def?.startTime ?? testStartTime;
	const duration = def?.duration ?? DEFAULT_DURATION;

	// Build steps with calculated timing
	const steps = buildSteps(def?.steps ?? [], startTime);

	return {
		status: def?.status ?? "passed",
		startTime,
		duration,
		steps,
	} as TestResult;
}

function buildSteps(
	defs: StepDefinition[],
	parentStartTime: Date,
	offsetMs = 100,
): TestStep[] {
	let currentOffset = offsetMs;
	const steps: TestStep[] = [];

	for (const def of defs) {
		const stepStartTime =
			def.startTime ?? new Date(parentStartTime.getTime() + currentOffset);
		const duration = def.duration ?? DEFAULT_STEP_DURATION;

		// Build nested steps first (they occur during the parent step)
		const nestedSteps = buildSteps(def.steps ?? [], stepStartTime, 50);

		const step: TestStep = {
			title: def.title,
			category: def.category ?? DEFAULT_STEP_CATEGORY,
			startTime: stepStartTime,
			duration,
			steps: nestedSteps,
			error: def.error,
			location: def.location
				? {
						file: def.location.file,
						line: def.location.line,
						column: def.location.column ?? 1,
					}
				: undefined,
		} as TestStep;

		steps.push(step);
		currentOffset += duration + 50; // Add gap between sibling steps
	}

	return steps;
}

async function executeStepHooks(
	reporter: PlaywrightOpentelemetryReporter,
	test: TestCase,
	result: TestResult,
	steps: TestStep[],
	stepDefs: StepDefinition[],
) {
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		const stepDef = stepDefs[i];

		// Call onStepBegin
		reporter.onStepBegin(test, result, step);

		// Execute network actions if present (simulating fixture calls during step)
		if (stepDef?.networkActions) {
			for (const networkAction of stepDef.networkActions) {
				// Create a mock route object for the fixture propagator
				const mockRoute = {
					request: () => ({
						url: () => networkAction.url,
						method: () => networkAction.method,
					}),
					continue: async () => {},
				};

				await playwrightFixturePropagator({
					route: mockRoute as Parameters<
						typeof playwrightFixturePropagator
					>[0]["route"],
					testId: test.title,
					outputDir: "/tmp/test-output",
				});
			}
		}

		// Process nested steps (depth-first)
		if (step.steps && step.steps.length > 0) {
			await executeStepHooks(
				reporter,
				test,
				result,
				step.steps,
				stepDef?.steps ?? [],
			);
		}

		// Call onStepEnd
		reporter.onStepEnd(test, result, step);
	}
}

export interface TestHarnessResult {
	reporter: PlaywrightOpentelemetryReporter;
}
