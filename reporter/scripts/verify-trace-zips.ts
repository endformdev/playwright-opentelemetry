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
	errors: string[];
}

interface OtlpTrace {
	resourceSpans?: Array<{
		scopeSpans?: Array<{
			spans?: Array<unknown>;
		}>;
	}>;
}

async function main() {
	console.log("=== Trace Zip E2E Verification ===\n");

	// Step 1: Clean up existing test results
	console.log("1. Cleaning up existing test results...");
	try {
		await rm(TEST_RESULTS_DIR, { recursive: true, force: true });
		console.log(`   Removed ${TEST_RESULTS_DIR}\n`);
	} catch {
		console.log("   No existing test results to clean up\n");
	}

	// Step 2: Run e2e tests
	console.log("2. Running e2e tests...");
	try {
		await $`pnpm test:e2e`.cwd(path.join(import.meta.dirname, ".."));
	} catch {
		// Tests might fail but we still want to check the zip files
		console.log("   Tests completed (with possible failures)\n");
	}

	// Step 3: Find generated zip files
	console.log("3. Finding generated zip files...");
	const zipFiles = await findZipFiles(TEST_RESULTS_DIR);

	if (zipFiles.length === 0) {
		console.log("   ERROR: No zip files found in test-results/\n");
		process.exit(1);
	}

	console.log(`   Found ${zipFiles.length} zip file(s)\n`);

	// Step 4: Verify each zip file
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
		} else {
			for (const error of result.errors) {
				console.log(`     Error: ${error}`);
			}
		}
		console.log();
	}

	// Summary
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

	// Create a temporary directory to extract the zip
	const tempDir = await mkdtemp(path.join(tmpdir(), "verify-trace-"));

	try {
		// Extract the zip file using native unzip command
		await $`unzip -q ${zipPath} -d ${tempDir}`;

		// Check for OTLP trace file
		const tracePath = path.join(
			tempDir,
			"otlp-traces",
			"pw-reporter-trace.json",
		);

		try {
			const traceContent = await readFile(tracePath, "utf-8");
			const traceData = JSON.parse(traceContent) as OtlpTrace;

			if (!traceData.resourceSpans || !Array.isArray(traceData.resourceSpans)) {
				errors.push("Invalid OTLP structure: missing resourceSpans array");
			} else {
				// Count spans
				for (const rs of traceData.resourceSpans) {
					if (rs.scopeSpans) {
						for (const ss of rs.scopeSpans) {
							if (ss.spans) {
								spanCount += ss.spans.length;
							}
						}
					}
				}

				if (spanCount === 0) {
					errors.push("OTLP trace contains no spans");
				}
			}
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				errors.push("Missing otlp-traces/pw-reporter-trace.json");
			} else {
				errors.push(`Failed to parse trace JSON: ${err}`);
			}
		}

		// Check for screenshots
		const screenshotsDir = path.join(tempDir, "screenshots");
		let screenshotFiles: string[] = [];

		try {
			const entries = await readdir(screenshotsDir);
			screenshotFiles = entries.filter(
				(name) => name.endsWith(".jpeg") || name.endsWith(".jpg"),
			);
		} catch {
			// Directory doesn't exist
		}

		screenshotCount = screenshotFiles.length;

		if (screenshotCount === 0) {
			errors.push("No screenshots found in screenshots/ directory");
		} else {
			// Validate screenshot naming convention: {page}@{pageGuid}-{timestamp}.jpeg
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
		// Cleanup temp directory
		await rm(tempDir, { recursive: true, force: true });
	}

	return {
		filename,
		passed: errors.length === 0,
		spanCount,
		screenshotCount,
		errors,
	};
}

main();
