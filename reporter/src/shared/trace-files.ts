import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { generateTraceId } from "./otel";

export { generateSpanId, generateTraceId } from "./otel";

export const PW_OTEL_DIR = "playwright-opentelemetry";

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
	/** Service name for this span (browser network spans use a different service) */
	serviceName?: string;
}

export interface BrowserPageSpan {
	traceId: string;
	spanId: string;
	parentSpanId: string;
	name: string;
	kind?: number;
	startTime: Date;
	endTime: Date;
	status: { code: number };
	attributes: Record<string, string | number | boolean>;
	serviceName?: string;
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
	mkdirSync(getBrowserPageSpanDir(outputDir, testId), { recursive: true });
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

export function writeBrowserPageSpan(
	outputDir: string,
	testId: string,
	span: BrowserPageSpan,
) {
	const pageSpanPath = getBrowserPageSpanPath(outputDir, testId, span.spanId);
	const serialized = {
		...span,
		startTime: span.startTime.toISOString(),
		endTime: span.endTime.toISOString(),
	};

	writeFileSync(pageSpanPath, JSON.stringify(serialized));
}

export async function collectBrowserPageSpans(
	outputDir: string,
	testId: string,
	networkSpans: NetworkSpan[],
	fallbackEndTime: Date,
): Promise<BrowserPageSpan[]> {
	const pageSpanDir = getBrowserPageSpanDir(outputDir, testId);

	try {
		const files = await fs.readdir(pageSpanDir);
		const spans: BrowserPageSpan[] = [];

		for (const file of files) {
			const content = await fs.readFile(path.join(pageSpanDir, file), "utf-8");
			const parsed = JSON.parse(content);
			spans.push({
				...parsed,
				startTime: new Date(parsed.startTime),
				endTime: new Date(parsed.endTime),
			});
		}

		return finalizeBrowserPageSpanEndTimes(
			spans,
			networkSpans,
			fallbackEndTime,
		);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw err;
	}
}

function finalizeBrowserPageSpanEndTimes(
	spans: BrowserPageSpan[],
	networkSpans: NetworkSpan[],
	fallbackEndTime: Date,
): BrowserPageSpan[] {
	const spansByPageId = new Map<string, BrowserPageSpan[]>();
	const nextSpanBySpanId = new Map<string, BrowserPageSpan>();

	for (const span of spans) {
		const pageId = span.attributes["browser.page.id"];
		if (typeof pageId !== "string") {
			span.endTime = fallbackEndTime;
			continue;
		}

		const pageSpans = spansByPageId.get(pageId) ?? [];
		pageSpans.push(span);
		spansByPageId.set(pageId, pageSpans);
	}

	for (const pageSpans of spansByPageId.values()) {
		pageSpans.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
		for (let i = 0; i < pageSpans.length; i++) {
			const span = pageSpans[i];
			const nextSpan = pageSpans[i + 1];
			if (nextSpan) {
				nextSpanBySpanId.set(span.spanId, nextSpan);
			}
			span.endTime = nextSpan?.startTime ?? fallbackEndTime;
		}
	}

	for (const networkSpan of networkSpans) {
		const parentPageSpan = spans.find(
			(span) => span.spanId === networkSpan.parentSpanId,
		);

		if (
			parentPageSpan &&
			!nextSpanBySpanId.has(parentPageSpan.spanId) &&
			networkSpan.endTime > parentPageSpan.endTime
		) {
			parentPageSpan.endTime = networkSpan.endTime;
		}
	}

	return spans.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
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

	try {
		await fs.rm(getBrowserPageSpanDir(outputDir, testId), { recursive: true });
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}
}

// Helper functions

function getTracePath(outputDir: string, testId: string): string {
	return path.join(outputDir, PW_OTEL_DIR, `${sanitizeTestId(testId)}.trace`);
}

function getSpanPath(outputDir: string, testId: string): string {
	return path.join(outputDir, PW_OTEL_DIR, `${sanitizeTestId(testId)}.span`);
}

function getNetworkParentDir(outputDir: string, testId: string): string {
	return path.join(
		outputDir,
		PW_OTEL_DIR,
		`${sanitizeTestId(testId)}-network-parents`,
	);
}

function getNetworkSpanDir(outputDir: string, testId: string): string {
	return path.join(
		outputDir,
		PW_OTEL_DIR,
		`${sanitizeTestId(testId)}-network-spans`,
	);
}

function getBrowserPageSpanDir(outputDir: string, testId: string): string {
	return path.join(
		outputDir,
		PW_OTEL_DIR,
		`${sanitizeTestId(testId)}-browser-page-spans`,
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

function getBrowserPageSpanPath(
	outputDir: string,
	testId: string,
	spanId: string,
): string {
	return path.join(getBrowserPageSpanDir(outputDir, testId), spanId);
}

/**
 * Sanitize test ID for use as filename.
 * Replaces characters that are invalid in filenames.
 */
function sanitizeTestId(testId: string): string {
	return testId.replace(/[<>:"/\\|?*]/g, "_");
}
