import path from "node:path";
import type { TestCase, TestResult, TestStep } from "@playwright/test/reporter";
import type { Span } from "../shared/otel";
import {
	ATTR_CODE_FILE_PATH,
	ATTR_CODE_LINE_NUMBER,
	ATTR_TEST_CASE_NAME,
	ATTR_TEST_CASE_RESULT_STATUS,
	ATTR_TEST_CASE_TITLE,
} from "./otel-attributes";

/** Attributes of the root `playwright.test` span. */
export function testSpanAttributes(
	test: TestCase,
	result: TestResult,
	rootDir: string | undefined,
): Span["attributes"] {
	const attributes: Record<string, string | number | boolean | string[]> = {};

	// titlePath format: ['', 'project', 'filename', ...describes, 'testname']
	// We want: [...describes, 'testname'] joined with ' > '
	const titlePath = test.titlePath();
	if (titlePath.length >= 3) {
		// Skip root (''), project name, and filename to get describes and test name
		const caseName = titlePath.slice(3).join(" > ");
		attributes[ATTR_TEST_CASE_NAME] = caseName;
	}

	const describes = titlePath.length > 4 ? titlePath.slice(3, -1) : [];

	attributes[ATTR_TEST_CASE_TITLE] = test.title;
	attributes[ATTR_TEST_CASE_RESULT_STATUS] =
		result.status === "passed" ? "pass" : "fail";
	attributes["playwright.test.status"] = result.status;
	attributes["playwright.test.describes"] = describes;

	if (test.location) {
		const { file, line } = test.location;
		const relativePath = rootDir ? path.relative(rootDir, file) : file;

		attributes[ATTR_CODE_FILE_PATH] = relativePath;
		attributes[ATTR_CODE_LINE_NUMBER] = line;
	}

	return attributes;
}

const ANSI_ESCAPE_PATTERN =
	/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const ORPHANED_ANSI_SGR_PATTERN = /\[(?:\d{1,3};)*\d{1,3}m/g;

export function errorStatus(
	message: string | undefined,
): NonNullable<Span["status"]> {
	if (!message) {
		return { code: 2 };
	}

	const cleanedMessage = cleanErrorMessage(message);
	return cleanedMessage ? { code: 2, message: cleanedMessage } : { code: 2 };
}

function cleanErrorMessage(message: string): string {
	return message
		.replace(ANSI_ESCAPE_PATTERN, "")
		.replace(ORPHANED_ANSI_SGR_PATTERN, "")
		.replace(/\r\n?/g, "\n")
		.trim();
}

export function isInternalFixtureStep(step: TestStep): boolean {
	if (step.category !== "fixture" || !step.location?.file) {
		return false;
	}

	return isInternalFixtureFile(step.location.file);
}

export function isInternalApiRequestStep(step: TestStep): boolean {
	if (step.category !== "pw:api" || !step.location?.file) {
		return false;
	}

	return (
		isApiRequestStepTitle(step.title) &&
		isInternalFixtureFile(step.location.file)
	);
}

function isApiRequestStepTitle(title: string): boolean {
	return /^(?:DELETE|FETCH|GET|HEAD|PATCH|POST|PUT)\s+"/.test(title);
}

function isInternalFixtureFile(filePath: string): boolean {
	const file = filePath.replace(/\\/g, "/");
	return INTERNAL_FIXTURE_FILE_PATTERNS.some((pattern) => pattern.test(file));
}

const INTERNAL_FIXTURE_FILE_PATTERNS = [
	/(?:^|\/)dist\/playwright-opentelemetry-fixture-[^/]+\.(?:mjs|cjs|js)$/,
	/(?:^|\/)dist\/fixture\.(?:mjs|cjs|js)$/,
	/(?:^|\/)playwright-opentelemetry\/dist\/fixture\.(?:mjs|cjs|js)$/,
	/(?:^|\/)playwright-opentelemetry\/reporter\/dist\/fixture\.(?:mjs|cjs|js)$/,
	/(?:^|\/)playwright-opentelemetry\/dist\/playwright-opentelemetry-fixture-[^/]+\.(?:mjs|cjs|js)$/,
	/(?:^|\/)playwright-opentelemetry\/dist\/fixture\/index\.(?:mjs|cjs|js)$/,
	/(?:^|\/)playwright-opentelemetry\/(?:reporter\/)?src\/fixture\/playwright-opentelemetry-fixture\.ts$/,
	/(?:^|\/)playwright-opentelemetry\/(?:reporter\/)?src\/fixture\/api-request-capture\.ts$/,
] as const;
