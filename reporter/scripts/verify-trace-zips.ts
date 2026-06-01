#!/usr/bin/env bun

/**
 * E2E Verification Script for Trace Zip Creation
 *
 * This script verifies that the playwright-opentelemetry reporter correctly
 * creates zip files containing OTLP traces and screenshots.
 */

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { $ } from "bun";

const TEST_RESULTS_DIR = path.join(import.meta.dirname, "..", "test-results");

interface VerificationResult {
	filename: string;
	passed: boolean;
	spanCount?: number;
	screenshotCount?: number;
	testSpan?: OtlpSpan;
	errors: string[];
}

interface OtlpTrace {
	resourceSpans?: Array<{
		scopeSpans?: Array<{
			spans?: OtlpSpan[];
		}>;
	}>;
}

interface OtlpSpan {
	name?: string;
	traceId?: string;
	startTimeUnixNano?: string;
	endTimeUnixNano?: string;
	attributes?: Array<{ key?: string; value?: unknown }>;
}

async function main() {
	console.log("=== Trace Zip E2E Verification ===\n");

	console.log("1. Cleaning up existing test results...");
	try {
		await rm(TEST_RESULTS_DIR, { recursive: true, force: true });
		console.log(`   Removed ${TEST_RESULTS_DIR}\n`);
	} catch {
		console.log("   No existing test results to clean up\n");
	}

	console.log("2. Running e2e tests...");
	try {
		await $`pnpm test:e2e`.cwd(path.join(import.meta.dirname, ".."));
	} catch {
		console.log("   Tests completed (with possible failures)\n");
	}

	console.log("3. Finding generated zip files...");
	const zipFiles = await findZipFiles(TEST_RESULTS_DIR);

	if (zipFiles.length === 0) {
		console.log("   ERROR: No zip files found in test-results/\n");
		process.exit(1);
	}

	console.log(`   Found ${zipFiles.length} zip file(s)\n`);

	console.log("4. Verifying zip contents...\n");
	const results: VerificationResult[] = [];

	for (const zipFile of zipFiles) {
		const result = await verifyZipFile(zipFile);
		results.push(result);

		const status = result.passed ? "✓" : "✗";
		console.log(`   ${status} ${result.filename}`);

		if (result.passed) {
			console.log(
				`     Spans: ${result.spanCount}, Screenshots: ${result.screenshotCount}`,
			);
			if (result.testSpan) {
				const attrs = attributesByKey(result.testSpan.attributes ?? []);
				console.log(
					`     Test: "${stringAttribute(attrs, "test.case.title") ?? result.testSpan.name}" (${stringAttribute(attrs, "playwright.test.status") ?? "unknown"})`,
				);
				const file = stringAttribute(attrs, "code.file.path");
				const line = numberAttribute(attrs, "code.line.number");
				if (file) {
					console.log(`     File: ${file}${line ? `:${line}` : ""}`);
				}
			}
		} else {
			for (const error of result.errors) {
				console.log(`     Error: ${error}`);
			}
		}
		console.log();
	}

	const passed = results.filter((r) => r.passed).length;
	const failed = results.filter((r) => !r.passed).length;

	console.log("=== Summary ===");
	console.log(`Total: ${results.length}, Passed: ${passed}, Failed: ${failed}`);
	console.log();

	if (failed > 0) {
		console.log("Verification FAILED");
		process.exit(1);
	}

	console.log("Verification PASSED");
}

async function findZipFiles(dir: string): Promise<string[]> {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		const zipFiles: string[] = [];

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				const nestedZips = await findZipFiles(fullPath);
				zipFiles.push(...nestedZips);
			} else if (entry.name.endsWith("-pw-otel.zip")) {
				zipFiles.push(fullPath);
			}
		}

		return zipFiles;
	} catch {
		return [];
	}
}

async function verifyZipFile(zipPath: string): Promise<VerificationResult> {
	const filename = path.basename(zipPath);
	const errors: string[] = [];
	let spanCount = 0;
	let screenshotCount = 0;
	let testSpan: OtlpSpan | undefined;

	const tempDir = await mkdtemp(path.join(tmpdir(), "verify-trace-"));

	try {
		await $`unzip -q ${zipPath} -d ${tempDir}`;

		const tracePath = path.join(
			tempDir,
			"opentelemetry-protocol",
			"playwright-opentelemetry.json",
		);

		try {
			const traceContent = await readFile(tracePath, "utf-8");
			const traceData = JSON.parse(traceContent) as OtlpTrace;

			if (!traceData.resourceSpans || !Array.isArray(traceData.resourceSpans)) {
				errors.push("Invalid OTLP structure: missing resourceSpans array");
			} else {
				for (const rs of traceData.resourceSpans) {
					if (rs.scopeSpans) {
						for (const ss of rs.scopeSpans) {
							if (ss.spans) {
								spanCount += ss.spans.length;
								testSpan ??= ss.spans.find(
									(span) => span.name === "playwright.test",
								);
							}
						}
					}
				}

				if (spanCount === 0) {
					errors.push("OTLP trace contains no spans");
				}
				if (!testSpan) {
					errors.push("OTLP trace is missing root playwright.test span");
				} else {
					validateTestSpan(testSpan, errors);
				}
			}
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				errors.push(
					"Missing opentelemetry-protocol/playwright-opentelemetry.json",
				);
			} else {
				errors.push(`Failed to parse trace JSON: ${err}`);
			}
		}

		const screenshotsDir = path.join(tempDir, "screenshots");
		let screenshotFiles: string[] = [];

		try {
			const entries = await readdir(screenshotsDir);
			screenshotFiles = entries.filter(
				(name) => name.endsWith(".jpeg") || name.endsWith(".jpg"),
			);
		} catch {
			// Directory doesn't exist.
		}

		screenshotCount = screenshotFiles.length;

		if (screenshotCount === 0) {
			errors.push("No screenshots found in screenshots/ directory");
		} else {
			const screenshotPattern = /^[^@]+@[^-]+-\d+\.jpeg$/;

			for (const name of screenshotFiles) {
				if (!screenshotPattern.test(name)) {
					errors.push(`Screenshot does not match naming convention: ${name}`);
				}
			}
		}
	} catch (error) {
		errors.push(`Failed to read zip file: ${error}`);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}

	return {
		filename,
		passed: errors.length === 0,
		spanCount,
		screenshotCount,
		testSpan,
		errors,
	};
}

function validateTestSpan(span: OtlpSpan, errors: string[]): void {
	if (
		typeof span.traceId !== "string" ||
		!/^[0-9a-f]{32}$/.test(span.traceId)
	) {
		errors.push("playwright.test span: missing or invalid traceId");
	}
	if (
		typeof span.startTimeUnixNano !== "string" ||
		!/^[0-9]+$/.test(span.startTimeUnixNano)
	) {
		errors.push("playwright.test span: missing or invalid startTimeUnixNano");
	}
	if (
		typeof span.endTimeUnixNano !== "string" ||
		!/^[0-9]+$/.test(span.endTimeUnixNano)
	) {
		errors.push("playwright.test span: missing or invalid endTimeUnixNano");
	}

	const attrs = attributesByKey(span.attributes ?? []);
	for (const key of ["test.case.title", "playwright.test.status"]) {
		if (!stringAttribute(attrs, key)) {
			errors.push(`playwright.test span: missing ${key} attribute`);
		}
	}
}

function attributesByKey(
	attributes: Array<{ key?: string; value?: unknown }>,
): Map<string, unknown> {
	const result = new Map<string, unknown>();
	for (const attribute of attributes) {
		if (attribute.key) {
			result.set(attribute.key, attribute.value);
		}
	}
	return result;
}

function stringAttribute(
	attributes: Map<string, unknown>,
	key: string,
): string | undefined {
	const value = attributes.get(key);
	if (isOtlpStringValue(value)) {
		return value.stringValue;
	}
	return undefined;
}

function numberAttribute(
	attributes: Map<string, unknown>,
	key: string,
): number | undefined {
	const value = attributes.get(key);
	if (isOtlpIntValue(value)) {
		return value.intValue;
	}
	return undefined;
}

function isOtlpStringValue(value: unknown): value is { stringValue: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"stringValue" in value &&
		typeof value.stringValue === "string"
	);
}

function isOtlpIntValue(value: unknown): value is { intValue: number } {
	return (
		typeof value === "object" &&
		value !== null &&
		"intValue" in value &&
		typeof value.intValue === "number"
	);
}

main();
