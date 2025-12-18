import type {
	FullConfig,
	FullResult,
	Suite,
	TestCase,
	TestResult,
	TestStep,
} from "@playwright/test/reporter";
import { vi } from "vitest";
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
}

const DEFAULT_ROOT_DIR = "/Users/test/project/test-e2e";
const DEFAULT_VERSION = "1.56.1";
const DEFAULT_START_TIME = new Date("2025-11-06T10:00:00.000Z");
const DEFAULT_DURATION = 1000;
const DEFAULT_STEP_DURATION = 100;
const DEFAULT_STEP_CATEGORY = "test.step";

const DEFAULT_REPORTER_OPTIONS: PlaywrightOpentelemetryReporterOptions = {
	otlpEndpoint: "http://localhost:4317/v1/traces",
	debug: true,
};

function buildConfig(def?: ConfigDefinition): FullConfig {
	return {
		rootDir: def?.rootDir ?? DEFAULT_ROOT_DIR,
		version: def?.version ?? DEFAULT_VERSION,
	} as FullConfig;
}

function buildTestCase(def: TestDefinition, config: FullConfig): TestCase {
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

function buildTestResult(
	def: ResultDefinition | undefined,
	testStartTime: Date,
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

function executeStepHooks(
	reporter: PlaywrightOpentelemetryReporter,
	test: TestCase,
	result: TestResult,
	steps: TestStep[],
) {
	for (const step of steps) {
		// Call onStepBegin
		reporter.onStepBegin(test, result, step);

		// Process nested steps (depth-first)
		if (step.steps && step.steps.length > 0) {
			executeStepHooks(reporter, test, result, step.steps);
		}

		// Call onStepEnd
		reporter.onStepEnd(test, result, step);
	}
}

export interface TestHarnessResult {
	reporter: PlaywrightOpentelemetryReporter;
}

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
export async function runReporterTest(
	options: TestHarnessOptions,
): Promise<TestHarnessResult> {
	// Merge reporter options with defaults
	const reporterOptions: PlaywrightOpentelemetryReporterOptions = {
		...DEFAULT_REPORTER_OPTIONS,
		...options.reporterOptions,
	};

	// Create reporter
	const reporter = new PlaywrightOpentelemetryReporter(reporterOptions);

	// Build mock objects
	const config = buildConfig(options.config);
	const testCase = buildTestCase(options.test, config);
	const testResult = buildTestResult(options.result, DEFAULT_START_TIME);

	// Execute hooks in order
	reporter.onBegin(config, {} as Suite);
	reporter.onTestBegin(testCase);

	// Execute step hooks (depth-first: begin -> nested -> end)
	if (testResult.steps && testResult.steps.length > 0) {
		executeStepHooks(reporter, testCase, testResult, testResult.steps);
	}

	reporter.onTestEnd(testCase, testResult);
	await reporter.onEnd({} as FullResult);

	return { reporter };
}
