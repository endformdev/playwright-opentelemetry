import { constants, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * File-based trace coordination between Playwright fixture and reporter.
 *
 * The fixture runs in worker processes while the reporter runs in the main process.
 * These utilities use atomic file operations to coordinate trace IDs, span context,
 * and network span collection across process boundaries.
 */

const OTEL_DIR = "otel";

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

/**
 * Get or create a trace ID for a test.
 * Uses O_CREAT | O_EXCL for atomic first-writer-wins semantics.
 *
 * @param outputDir - The Playwright output directory
 * @param testId - The unique test identifier
 * @returns The trace ID (either newly created or existing)
 */
export async function getOrCreateTraceId(
	outputDir: string,
	testId: string,
): Promise<string> {
	const tracePath = getTracePath(outputDir, testId);
	await fs.mkdir(path.dirname(tracePath), { recursive: true });

	try {
		// Attempt atomic exclusive creation
		const fh = await fs.open(
			tracePath,
			constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
		);
		const traceId = generateTraceId();
		await fh.writeFile(JSON.stringify({ traceId }));
		await fh.close();
		return traceId;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "EEXIST") {
			// File already exists, read the existing trace ID
			const content = await fs.readFile(tracePath, "utf-8");
			return JSON.parse(content).traceId;
		}
		throw err;
	}
}

/**
 * Push a span context onto the stack for a test.
 * Called by the reporter when entering a test or step.
 *
 * @param outputDir - The Playwright output directory
 * @param testId - The unique test identifier
 * @param spanId - The span ID being entered
 * @param name - The name of the span (test title or step title)
 */
export function pushSpanContext(
	outputDir: string,
	testId: string,
	spanId: string,
	name: string,
): void {
	const spanPath = getSpanPath(outputDir, testId);
	mkdirSync(path.dirname(spanPath), { recursive: true });

	const stack = readSpanStackSync(spanPath);
	stack.push({ spanId, name });
	writeFileSync(spanPath, JSON.stringify({ stack }));
}

/**
 * Pop the current span context from the stack.
 * Called by the reporter when exiting a step.
 *
 * @param outputDir - The Playwright output directory
 * @param testId - The unique test identifier
 * @returns The popped span context, or undefined if stack was empty
 */
export function popSpanContext(
	outputDir: string,
	testId: string,
): SpanContext | undefined {
	const spanPath = getSpanPath(outputDir, testId);

	const stack = readSpanStackSync(spanPath);
	const popped = stack.pop();
	writeFileSync(spanPath, JSON.stringify({ stack }));
	return popped;
}

/**
 * Get the current span ID from the top of the stack.
 * Called by the fixture to determine the parent span for HTTP requests.
 *
 * @param outputDir - The Playwright output directory
 * @param testId - The unique test identifier
 * @returns The current span ID, or undefined if no context exists
 */
export function getCurrentSpanId(
	outputDir: string,
	testId: string,
): string | undefined {
	const spanPath = getSpanPath(outputDir, testId);

	const stack = readSpanStackSync(spanPath);
	if (stack.length === 0) {
		return undefined;
	}
	return stack[stack.length - 1].spanId;
}

/**
 * Write a network span to the test's spans directory.
 * Called by the fixture after intercepting an HTTP request.
 *
 * @param outputDir - The Playwright output directory
 * @param testId - The unique test identifier
 * @param span - The network span to write
 */
export async function writeNetworkSpan(
	outputDir: string,
	testId: string,
	span: NetworkSpan,
): Promise<void> {
	const spansDir = getSpansDir(outputDir, testId);
	await fs.mkdir(spansDir, { recursive: true });

	// Generate unique filename with timestamp and random suffix
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 8);
	const filename = `req-${timestamp}-${random}.json`;
	const spanPath = path.join(spansDir, filename);

	// Serialize dates to ISO strings for JSON storage
	const serialized = {
		...span,
		startTime: span.startTime.toISOString(),
		endTime: span.endTime.toISOString(),
	};

	await fs.writeFile(spanPath, JSON.stringify(serialized));
}

/**
 * Collect all network spans for a test.
 * Called by the reporter at onTestEnd to gather HTTP client spans.
 *
 * @param outputDir - The Playwright output directory
 * @param testId - The unique test identifier
 * @returns Array of network spans
 */
export async function collectNetworkSpans(
	outputDir: string,
	testId: string,
): Promise<NetworkSpan[]> {
	const spansDir = getSpansDir(outputDir, testId);

	try {
		const files = await fs.readdir(spansDir);
		const spans: NetworkSpan[] = [];

		for (const file of files) {
			if (!file.endsWith(".json")) continue;

			const content = await fs.readFile(path.join(spansDir, file), "utf-8");
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

	// Remove spans directory
	try {
		await fs.rm(getSpansDir(outputDir, testId), { recursive: true });
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

function getSpansDir(outputDir: string, testId: string): string {
	return path.join(outputDir, OTEL_DIR, sanitizeTestId(testId));
}

/**
 * Sanitize test ID for use as filename.
 * Replaces characters that are invalid in filenames.
 */
function sanitizeTestId(testId: string): string {
	return testId.replace(/[<>:"/\\|?*]/g, "_");
}

function readSpanStackSync(spanPath: string): SpanContext[] {
	try {
		const content = readFileSync(spanPath, "utf-8");
		if (!content || content.trim() === "") {
			return [];
		}
		const parsed = JSON.parse(content);
		return parsed.stack ?? [];
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		const name = (err as Error).name;
		// File doesn't exist - return empty stack
		if (code === "ENOENT") {
			return [];
		}
		// JSON parse error - return empty stack
		if (name === "SyntaxError") {
			return [];
		}
		throw err;
	}
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
