import type { Request, Response, Route } from "@playwright/test";
import type {
	FullConfig,
	FullResult,
	Suite,
	TestCase,
	TestResult,
	TestStep,
} from "@playwright/test/reporter";
import { fixtureOtelHeaderPropagator } from "../src/fixture/network-propagator";
import { fixtureCaptureRequestResponse } from "../src/fixture/request-response-capture";
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
	/** Output directory for the test project (used for trace file coordination) */
	outputDir?: string;
	version?: string;
}

export interface TestDefinition {
	id?: string;
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
	/** When the request started (absolute time) */
	startTime?: Date;
	/** Duration of the request in milliseconds */
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
export const DEFAULT_OUTPUT_DIR = "/tmp/playwright-test-output";
export const DEFAULT_VERSION = "1.56.1";
export const DEFAULT_START_TIME = new Date("2025-11-06T10:00:00.000Z");

/** Generate a unique output directory for a test to avoid conflicts */
export function getUniqueOutputDir(testId?: string): string {
	const uniqueId =
		testId ??
		`test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
	return `${DEFAULT_OUTPUT_DIR}/${uniqueId}`;
}
const DEFAULT_DURATION = 1000;
const DEFAULT_STEP_DURATION = 100;
const DEFAULT_STEP_CATEGORY = "test.step";

export const DEFAULT_REPORTER_OPTIONS: PlaywrightOpentelemetryReporterOptions =
	{
		otlpEndpoint: "http://localhost:4317/v1/traces",
		debug: true,
	};

// Re-export for convenience in tests
export {
	PlaywrightOpentelemetryReporter,
	fixtureOtelHeaderPropagator,
	fixtureCaptureRequestResponse,
};
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
	// Generate a unique test ID if not provided
	const testId =
		test.id ?? `test-${test.title.replace(/\s+/g, "-").toLowerCase()}`;
	// Use unique output directory per test to avoid conflicts
	const outputDir = config?.outputDir ?? getUniqueOutputDir(testId);
	const testCase = buildTestCase(test, outputDir);
	const testResult = buildTestResult(result, DEFAULT_START_TIME);

	// Create mock suite that returns the test case
	const mockSuite = {
		allTests: () => [testCase],
	} as Suite;

	// Execute hooks in order
	reporter.onBegin(mergedConfig, mockSuite);
	await reporter.onTestBegin(testCase);

	// Execute step hooks (depth-first: begin -> nested -> end)
	if (testResult.steps && testResult.steps.length > 0) {
		await executeStepHooks(
			reporter,
			testCase,
			testResult,
			testResult.steps,
			result?.steps ?? [],
			outputDir,
		);
	}

	await reporter.onTestEnd(testCase, testResult);
	await reporter.onEnd({} as FullResult);

	return { reporter };
}

export interface MockNetworkObjects {
	route: Route;
	request: Request;
	response: Response;
}

export interface MockNetworkOptions {
	statusCode?: number;
	/** Request start time (absolute) - used for timing calculation */
	startTime?: Date;
	/** Request duration in milliseconds */
	duration?: number;
}

/**
 * Creates mock Playwright Route, Request, and Response objects for testing the fixture functions.
 * The returned objects can be used with:
 * - fixtureOtelHeaderPropagator (route + request) - for trace header propagation
 * - fixtureCaptureRequestResponse (request + response) - for capturing request/response data
 *
 * The mock captures headers passed to route.fallback() and exposes them via request.allHeaders()
 */
export function createMockNetworkObjects(
	method: string,
	url: string,
	options?: MockNetworkOptions,
): MockNetworkObjects {
	const statusCode = options?.statusCode ?? 200;
	const duration = options?.duration ?? 100;
	const startTime = options?.startTime ?? new Date();

	// Mutable headers object that gets populated when route.fallback is called
	let capturedHeaders: Record<string, string> = {};

	const request = {
		url: () => url,
		method: () => method,
		headers: () => ({}),
		allHeaders: async () => capturedHeaders,
		headerValue: async (name: string) => capturedHeaders[name] ?? null,
		timing: () => ({
			// Playwright timing() returns:
			// - startTime: absolute timestamp in ms since epoch
			// - other values: relative to startTime in ms (-1 if not available)
			startTime: startTime.getTime(),
			domainLookupStart: -1,
			domainLookupEnd: -1,
			connectStart: -1,
			connectEnd: -1,
			secureConnectionStart: -1,
			requestStart: 0,
			responseStart: duration * 0.2, // First byte received at 20% of duration
			responseEnd: duration,
		}),
	} as unknown as Request;

	const response = {
		url: () => url,
		status: () => statusCode,
		request: () => request,
	} as Response;

	const route = {
		request: () => request,
		fetch: async () => response,
		fulfill: async () => {},
		continue: async () => {},
		fallback: async (options?: { headers?: Record<string, string> }) => {
			// Capture headers passed to fallback
			if (options?.headers) {
				capturedHeaders = options.headers;
			}
		},
		abort: async () => {},
	} as unknown as Route;

	return { route, request, response };
}

/**
 * Creates a mock Playwright Route object for testing the fixture propagator
 * @deprecated Use createMockNetworkObjects instead for the new architecture
 */
export function createMockRoute(
	method: string,
	url: string,
	options?: { statusCode?: number },
) {
	return createMockNetworkObjects(method, url, options).route;
}

export function buildConfig(def?: ConfigDefinition): FullConfig {
	return {
		rootDir: def?.rootDir ?? DEFAULT_ROOT_DIR,
		version: def?.version ?? DEFAULT_VERSION,
	} as FullConfig;
}

export function buildTestCase(
	def: TestDefinition,
	outputDir: string = DEFAULT_OUTPUT_DIR,
): TestCase {
	const titlePath = def.titlePath ?? [
		"",
		"chromium",
		"test.spec.ts",
		def.title,
	];

	// Generate a stable test ID from the title if not provided
	const id = def.id ?? `test-${def.title.replace(/\s+/g, "-").toLowerCase()}`;

	// Create a mock parent suite with project info
	const parentSuite = {
		project: () => ({
			outputDir,
		}),
	};

	return {
		id,
		title: def.title,
		titlePath: () => titlePath,
		expectedStatus: def.expectedStatus ?? "passed",
		parent: parentSuite,
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
	parentTitlePath: string[] = [],
): TestStep[] {
	let currentOffset = offsetMs;
	const steps: TestStep[] = [];

	for (const def of defs) {
		const stepStartTime =
			def.startTime ?? new Date(parentStartTime.getTime() + currentOffset);
		const duration = def.duration ?? DEFAULT_STEP_DURATION;

		// Build title path for this step (parent titles + current title)
		const stepTitlePath = [...parentTitlePath, def.title];

		// Build nested steps first (they occur during the parent step)
		const nestedSteps = buildSteps(
			def.steps ?? [],
			stepStartTime,
			50,
			stepTitlePath,
		);

		const step: TestStep = {
			title: def.title,
			titlePath: () => stepTitlePath,
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

/**
 * Simulates a network request happening during a test, calling the fixture functions
 * in the order they would be invoked in real Playwright execution:
 * 1. fixtureOtelHeaderPropagator - called via context.route() handler, propagates trace headers
 * 2. fixtureCaptureRequestResponse - called via page.on("response"), captures request and response data
 */
export async function simulateNetworkRequest(
	networkAction: NetworkAction,
	testId: string,
	outputDir: string,
): Promise<void> {
	const { route, request, response } = createMockNetworkObjects(
		networkAction.method,
		networkAction.url,
		{
			statusCode: networkAction.statusCode,
			startTime: networkAction.startTime,
			duration: networkAction.duration,
		},
	);

	// 1. Header propagation via context route handler
	await fixtureOtelHeaderPropagator({
		route,
		request,
		testId,
		outputDir,
	});

	// 2. Request/Response capture via page "response" event
	//    (response.request() gives us the request, so we capture both together)
	await fixtureCaptureRequestResponse({
		request,
		response,
		testId,
		outputDir,
	});
}

async function executeStepHooks(
	reporter: PlaywrightOpentelemetryReporter,
	test: TestCase,
	result: TestResult,
	steps: TestStep[],
	stepDefs: StepDefinition[],
	outputDir: string,
) {
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		const stepDef = stepDefs[i];

		// Call onStepBegin
		await reporter.onStepBegin(test, result, step);

		// Execute network actions if present (simulating fixture calls during step)
		if (stepDef?.networkActions) {
			for (const networkAction of stepDef.networkActions) {
				await simulateNetworkRequest(networkAction, test.id, outputDir);
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
				outputDir,
			);
		}

		// Call onStepEnd
		await reporter.onStepEnd(test, result, step);
	}
}

export interface TestHarnessResult {
	reporter: PlaywrightOpentelemetryReporter;
}
