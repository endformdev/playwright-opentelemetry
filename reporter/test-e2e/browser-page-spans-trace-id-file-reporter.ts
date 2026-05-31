import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

const TRACE_ID_ATTACHMENT_NAME = "playwright-opentelemetry-trace-id";
const BROWSER_PAGE_SPANS_TEST_NAME = "playwright.dev browser page navigation trace";

export default class BrowserPageSpansTraceIdFileReporter implements Reporter {
	onTestEnd(test: TestCase, result: TestResult): void {
		const browserPageSpansTraceIdFile =
			process.env.BROWSER_PAGE_SPANS_TRACE_ID_FILE;
		if (!browserPageSpansTraceIdFile || test.title !== BROWSER_PAGE_SPANS_TEST_NAME) {
			return;
		}

		const browserPageSpansTraceId = result.attachments
			.find((attachment) => attachment.name === TRACE_ID_ATTACHMENT_NAME)
			?.body?.toString("utf-8")
			.trim();

		if (!browserPageSpansTraceId) {
			throw new Error(`Missing ${TRACE_ID_ATTACHMENT_NAME} attachment`);
		}

		mkdirSync(path.dirname(browserPageSpansTraceIdFile), { recursive: true });
		writeFileSync(browserPageSpansTraceIdFile, browserPageSpansTraceId);
	}
}
