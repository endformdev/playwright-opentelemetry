import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

const TRACE_ID_ATTACHMENT_NAME = "playwright-opentelemetry-trace-id";
const BROWSER_PAGE_SPANS_TEST_NAME =
	"playwright.dev browser page navigation trace";

export default class BrowserPageSpansTraceIdFileReporter implements Reporter {
	onTestEnd(test: TestCase, result: TestResult): void {
		const browserPageSpansTraceIdFile =
			process.env.BROWSER_PAGE_SPANS_TRACE_ID_FILE;
		const browserPageSpansTraceZipPathFile =
			process.env.BROWSER_PAGE_SPANS_TRACE_ZIP_PATH_FILE;
		if (
			(!browserPageSpansTraceIdFile && !browserPageSpansTraceZipPathFile) ||
			test.title !== BROWSER_PAGE_SPANS_TEST_NAME
		) {
			return;
		}

		if (browserPageSpansTraceIdFile) {
			const browserPageSpansTraceId = result.attachments
				.find((attachment) => attachment.name === TRACE_ID_ATTACHMENT_NAME)
				?.body?.toString("utf-8")
				.trim();

			if (!browserPageSpansTraceId) {
				throw new Error(`Missing ${TRACE_ID_ATTACHMENT_NAME} attachment`);
			}

			writeFile(browserPageSpansTraceIdFile, browserPageSpansTraceId);
		}

		if (browserPageSpansTraceZipPathFile) {
			writeFile(browserPageSpansTraceZipPathFile, getTraceZipPath(test));
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
