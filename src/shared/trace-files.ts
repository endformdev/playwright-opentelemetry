import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const OTEL_DIR = "otel";

export interface SpanContext {
	spanId: string;
	name: string;
}

export interface NetworkSpan {
	traceId: string;
	spanId: string;
	parentSpanId: string;
	name: string;
	kind: number;
	startTime: Date;
	endTime: Date;
	status: { code: number };
	attributes: Record<string, string | number | boolean>;
}

export function getOrCreateTraceId(outputDir: string, testId: string): string {
	const tracePath = getTracePath(outputDir, testId);

	if (existsSync(tracePath)) {
		// File exists, read the existing trace ID
		return readFileSync(tracePath, "utf-8");
	}

	// File doesn't exist, create it with a newly generated trace ID
	const traceId = generateTraceId();
	writeFileSync(tracePath, traceId);
	return traceId;
}

/**
 * Write the current span ID to the span context file.
 * This is an append-only operation - the file maintains a log of all span context changes.
 * The fixture reads the last line to get the current parent span ID.
 */
export function writeCurrentSpanId(
	outputDir: string,
	testId: string,
	spanId: string,
): void {
	const spanPath = getSpanPath(outputDir, testId);
	writeFileSync(spanPath, `${spanId}\n`, { flag: "a" });
}

export function getCurrentSpanId(outputDir: string, testId: string): string {
	const spanPath = getSpanPath(outputDir, testId);
	const content = readFileSync(spanPath, "utf-8").trim();
	const lines = content.split("\n").filter((line) => line.length > 0);
	if (lines.length === 0) {
		throw new Error(`No span context found for test ${testId}`);
	}
	const lastLine = lines[lines.length - 1];
	if (!lastLine) {
		throw new Error(`No span context found for test ${testId}`);
	}
	return lastLine;
}

export function createNetworkDirs(outputDir: string, testId: string): void {
	mkdirSync(getNetworkParentDir(outputDir, testId), { recursive: true });
	mkdirSync(getNetworkSpanDir(outputDir, testId), { recursive: true });
}

export function writeNetworkSpanParent({
	outputDir,
	testId,
	parentSpanId,
	traceHeader,
}: {
	outputDir: string;
	testId: string;
	parentSpanId: string;
	traceHeader: string;
}): void {
	const parentPath = getNetworkParentPath(outputDir, testId, traceHeader);
	writeFileSync(parentPath, parentSpanId);
}

export function readNetworkSpanParent(
	outputDir: string,
	testId: string,
	traceHeader: string,
): string | undefined {
	const parentPath = getNetworkParentPath(outputDir, testId, traceHeader);
	try {
		return readFileSync(parentPath, "utf-8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw err;
	}
}

export function writeNetworkSpan(
	outputDir: string,
	testId: string,
	traceHeader: string,
	span: NetworkSpan,
) {
	const networkSpanPath = getNetworkSpanPath(outputDir, testId, traceHeader);

	// Serialize dates to ISO strings for JSON storage
	const serialized = {
		...span,
		startTime: span.startTime.toISOString(),
		endTime: span.endTime.toISOString(),
	};

	writeFileSync(networkSpanPath, JSON.stringify(serialized));
}

/**
 * Collect all network spans for a test.
 * Called by the reporter at onTestEnd to gather HTTP client spans.
 * Reads all files from the network spans directory.
 *
 * @param outputDir - The Playwright output directory
 * @param testId - The unique test identifier
 * @returns Array of network spans
 */
export async function collectNetworkSpans(
	outputDir: string,
	testId: string,
): Promise<NetworkSpan[]> {
	const networkSpanDir = getNetworkSpanDir(outputDir, testId);

	try {
		const files = await fs.readdir(networkSpanDir);
		const spans: NetworkSpan[] = [];

		for (const file of files) {
			const content = await fs.readFile(
				path.join(networkSpanDir, file),
				"utf-8",
			);
			const parsed = JSON.parse(content);

			// Deserialize dates from ISO strings
			spans.push({
				...parsed,
				startTime: new Date(parsed.startTime),
				endTime: new Date(parsed.endTime),
			});
		}

		return spans;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			// Directory doesn't exist, no spans captured
			return [];
		}
		throw err;
	}
}

/**
 * Cleanup all trace files for a test.
 * Called by the reporter after onTestEnd has processed the spans.
 *
 * @param outputDir - The Playwright output directory
 * @param testId - The unique test identifier
 */
export async function cleanupTestFiles(
	outputDir: string,
	testId: string,
): Promise<void> {
	// Remove trace file
	try {
		await fs.unlink(getTracePath(outputDir, testId));
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}

	// Remove span file
	try {
		await fs.unlink(getSpanPath(outputDir, testId));
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}

	// Remove network parents directory
	try {
		await fs.rm(getNetworkParentDir(outputDir, testId), { recursive: true });
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}

	// Remove network spans directory
	try {
		await fs.rm(getNetworkSpanDir(outputDir, testId), { recursive: true });
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}
}

// Helper functions

function getTracePath(outputDir: string, testId: string): string {
	return path.join(outputDir, OTEL_DIR, `${sanitizeTestId(testId)}.trace`);
}

function getSpanPath(outputDir: string, testId: string): string {
	return path.join(outputDir, OTEL_DIR, `${sanitizeTestId(testId)}.span`);
}

function getNetworkParentDir(outputDir: string, testId: string): string {
	return path.join(
		outputDir,
		OTEL_DIR,
		`${sanitizeTestId(testId)}-network-parents`,
	);
}

function getNetworkSpanDir(outputDir: string, testId: string): string {
	return path.join(
		outputDir,
		OTEL_DIR,
		`${sanitizeTestId(testId)}-network-spans`,
	);
}

function getNetworkParentPath(
	outputDir: string,
	testId: string,
	traceHeader: string,
): string {
	return path.join(getNetworkParentDir(outputDir, testId), traceHeader);
}

function getNetworkSpanPath(
	outputDir: string,
	testId: string,
	traceHeader: string,
): string {
	return path.join(getNetworkSpanDir(outputDir, testId), traceHeader);
}

/**
 * Sanitize test ID for use as filename.
 * Replaces characters that are invalid in filenames.
 */
function sanitizeTestId(testId: string): string {
	return testId.replace(/[<>:"/\\|?*]/g, "_");
}

/**
 * Generate a random 32-character hex trace ID.
 */
export function generateTraceId(): string {
	return Array.from({ length: 32 }, () =>
		Math.floor(Math.random() * 16).toString(16),
	).join("");
}

/**
 * Generate a random 16-character hex span ID.
 */
export function generateSpanId(): string {
	return Array.from({ length: 16 }, () =>
		Math.floor(Math.random() * 16).toString(16),
	).join("");
}
