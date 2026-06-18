import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

const BROWSER_PAGE_SPANS_TEST_NAME =
	"playwright.dev browser page navigation trace";
const ERROR_SPANS_TEST_NAME = "expected failing step trace";
const SPAN_EVENTS_TEST_NAME = "browser console and page error span events";
const MULTI_CONTEXT_SCREENSHOTS_TEST_NAME =
	"multiple browser contexts screenshot trace";

export default class BrowserPageSpansTraceIdFileReporter implements Reporter {
	onTestEnd(test: TestCase, result: TestResult): void {
		const browserPageSpansTraceIdFile =
			process.env.BROWSER_PAGE_SPANS_TRACE_ID_FILE;
		const browserPageSpansTraceZipPathFile =
			process.env.BROWSER_PAGE_SPANS_TRACE_ZIP_PATH_FILE;
		const errorSpansTraceIdFile = process.env.ERROR_SPANS_TRACE_ID_FILE;
		const spanEventsTraceIdFile = process.env.SPAN_EVENTS_TRACE_ID_FILE;
		const multiContextScreenshotsTraceIdFile =
			process.env.MULTI_CONTEXT_SCREENSHOTS_TRACE_ID_FILE;
		if (
			!browserPageSpansTraceIdFile &&
			!browserPageSpansTraceZipPathFile &&
			!errorSpansTraceIdFile &&
			!spanEventsTraceIdFile &&
			!multiContextScreenshotsTraceIdFile
		) {
			return;
		}
		if (
			test.title !== BROWSER_PAGE_SPANS_TEST_NAME &&
			test.title !== ERROR_SPANS_TEST_NAME &&
			test.title !== SPAN_EVENTS_TEST_NAME &&
			test.title !== MULTI_CONTEXT_SCREENSHOTS_TEST_NAME
		) {
			return;
		}

		const traceId = result.annotations
			.find(
				(annotation) =>
					annotation.type === "playwrightOpentelemetryTraceId",
			)
			?.description?.trim();

		if (!traceId) {
			throw new Error("Missing playwrightOpentelemetryTraceId annotation");
		}

		if (test.title === BROWSER_PAGE_SPANS_TEST_NAME) {
			if (browserPageSpansTraceIdFile) {
				writeFile(browserPageSpansTraceIdFile, traceId);
			}

			if (browserPageSpansTraceZipPathFile) {
				writeFile(browserPageSpansTraceZipPathFile, getTraceZipPath(test));
			}
		}

		if (test.title === ERROR_SPANS_TEST_NAME && errorSpansTraceIdFile) {
			writeFile(errorSpansTraceIdFile, traceId);
		}

		if (test.title === SPAN_EVENTS_TEST_NAME && spanEventsTraceIdFile) {
			writeFile(spanEventsTraceIdFile, traceId);
		}

		if (
			test.title === MULTI_CONTEXT_SCREENSHOTS_TEST_NAME &&
			multiContextScreenshotsTraceIdFile
		) {
			writeFile(multiContextScreenshotsTraceIdFile, traceId);
		}
	}
}

function writeFile(filePath: string, content: string): void {
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, content);
}

function getTraceZipPath(test: TestCase): string {
	const project = test.parent.project() as { outputDir?: string } | undefined;
	if (!project?.outputDir) {
		throw new Error(`No outputDir found for test "${test.id}"`);
	}

	if (!test.location) {
		return path.join(project.outputDir, `${test.id}-pw-otel.zip`);
	}

	return path.join(
		project.outputDir,
		`${path.basename(test.location.file)}:${test.location.line}-${test.id}-pw-otel.zip`,
	);
}
