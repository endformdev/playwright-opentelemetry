import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import type { BrowserContext, TestInfo } from "@playwright/test";
import type { eventWithTime } from "@rrweb/types";
import type { BrowserPageTracker } from "./browser-page-tracker";
import { RRWEB_RECORDINGS_ATTACHMENT_NAME } from "./trace-context";

declare const window: Record<string, unknown> & {
	addEventListener: (type: string, listener: () => void) => void;
};
declare const document: {
	visibilityState: string;
	addEventListener: (type: string, listener: () => void) => void;
};
declare const location: { href: string };

export interface RrwebFlushPayload {
	documentId: string;
	href: string;
	reason:
		| "interval"
		| "checkout"
		| "pagehide"
		| "visibilitychange"
		| "teardown"
		| "error";
	events: eventWithTime[];
	warnings?: string[];
}

export interface RrwebRecordingAttachment {
	id: string;
	pageId: string;
	documentId: string;
	initialUrl?: string;
	events: eventWithTime[];
	warnings?: string[];
}

export interface RrwebRecordingsAttachment {
	version: 1;
	recordings: RrwebRecordingAttachment[];
	warnings: string[];
}

interface ActiveRecording extends RrwebRecordingAttachment {
	lastUrl?: string;
}

const RRWEB_BINDING_NAME = "__playwrightOtelRrwebEmit";
const RRWEB_FLUSH_FUNCTION_NAME = "__playwrightOtelRrwebFlush";
const RRWEB_ATTACHMENT_FILENAME = "playwright-opentelemetry-rrweb.json";

export async function installRrwebRecorder({
	context,
	browserPageTracker,
	testInfo,
}: {
	context: BrowserContext;
	browserPageTracker: BrowserPageTracker;
	testInfo: TestInfo;
}): Promise<() => Promise<void>> {
	const recordingsByKey = new Map<string, ActiveRecording>();
	const warnings: string[] = [];
	let nextRecordingId = 1;

	await context.exposeBinding(
		RRWEB_BINDING_NAME,
		async (source, payload: RrwebFlushPayload) => {
			try {
				const page = source.page;
				if (!page || !isRrwebFlushPayload(payload)) {
					throw new Error("Invalid rrweb flush payload");
				}

				browserPageTracker.registerPage(page);
				const pageId = browserPageTracker.getPageId(page);
				const key = `${pageId}:${payload.documentId}`;
				let recording = recordingsByKey.get(key);
				if (!recording) {
					recording = {
						id: createRecordingId(pageId, nextRecordingId++),
						pageId,
						documentId: payload.documentId,
						initialUrl: payload.href,
						events: [],
						warnings: [],
					};
					recordingsByKey.set(key, recording);
				}

				recording.lastUrl = payload.href;
				recording.events.push(...payload.events);
				if (payload.warnings?.length) {
					recording.warnings?.push(...payload.warnings);
				}
			} catch (error) {
				warnings.push(
					`Failed to collect rrweb events: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
	);

	await context.addInitScript(await createRecorderInitScript());

	return async () => {
		await Promise.all(
			context.pages().map(async (page) => {
				try {
					await page.evaluate(
						([flushFunctionName]) => {
							const flush = (
								window as unknown as Record<
									string,
									((reason: string) => void) | undefined
								>
							)[flushFunctionName];
							flush?.("teardown");
						},
						[RRWEB_FLUSH_FUNCTION_NAME],
					);
				} catch {
					// Closed pages should already have flushed via pagehide/close paths.
				}
			}),
		);

		const attachment: RrwebRecordingsAttachment = {
			version: 1,
			recordings: Array.from(recordingsByKey.values()).map((recording) => ({
				id: recording.id,
				pageId: recording.pageId,
				documentId: recording.documentId,
				initialUrl: recording.initialUrl,
				events: recording.events.sort((a, b) => a.timestamp - b.timestamp),
				warnings: recording.warnings,
			})),
			warnings,
		};

		const attachmentPath = testInfo.outputPath(RRWEB_ATTACHMENT_FILENAME);
		await fs.writeFile(attachmentPath, JSON.stringify(attachment));
		await testInfo.attach(RRWEB_RECORDINGS_ATTACHMENT_NAME, {
			path: attachmentPath,
			contentType: "application/json",
		});
	};
}

async function createRecorderInitScript(): Promise<string> {
	const require = createRequire(import.meta.url);
	const recordEntry = require.resolve("@rrweb/record");
	const recordUmdPath = path.join(
		path.dirname(recordEntry),
		"record.umd.min.cjs",
	);
	const recordSource = await fs.readFile(recordUmdPath, "utf-8");
	return `${recordSource}\n;(${browserRecorderInstall.toString()})(${JSON.stringify(
		{
			bindingName: RRWEB_BINDING_NAME,
			flushFunctionName: RRWEB_FLUSH_FUNCTION_NAME,
		},
	)});`;
}

function browserRecorderInstall(options: {
	bindingName: string;
	flushFunctionName: string;
}) {
	type WindowWithRrweb = Record<string, unknown> & {
		addEventListener: (type: string, listener: () => void) => void;
		rrwebRecord?: {
			record?: (options: Record<string, unknown>) => (() => void) | undefined;
		};
	};

	const w = window as WindowWithRrweb;
	if (w.__playwrightOtelRrwebInstalled) return;
	w.__playwrightOtelRrwebInstalled = true;

	const record = w.rrwebRecord?.record;
	const binding = w[options.bindingName] as
		| ((payload: RrwebFlushPayload) => Promise<void>)
		| undefined;
	const documentId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const buffer: eventWithTime[] = [];
	let warnings: string[] = [];
	let flushTimer: ReturnType<typeof setTimeout> | undefined;
	let stopRecording: (() => void) | undefined;
	let flushing = false;

	const flush = (reason: RrwebFlushPayload["reason"]) => {
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = undefined;
		}
		if (
			!binding ||
			flushing ||
			(buffer.length === 0 && warnings.length === 0)
		) {
			return;
		}

		const events = buffer.splice(0, buffer.length);
		const payloadWarnings = warnings;
		warnings = [];
		flushing = true;
		void binding({
			documentId,
			href: location.href,
			reason,
			events,
			warnings: payloadWarnings,
		}).finally(() => {
			flushing = false;
		});
	};

	const scheduleFlush = () => {
		if (flushTimer) return;
		flushTimer = setTimeout(() => flush("interval"), 1000);
	};

	w[options.flushFunctionName] = (reason: RrwebFlushPayload["reason"]) => {
		flush(reason);
		stopRecording?.();
	};

	if (!record || !binding) {
		return;
	}

	try {
		stopRecording = record({
			emit(event: eventWithTime, isCheckout: boolean) {
				buffer.push(event);
				if (isCheckout) {
					flush("checkout");
					return;
				}
				scheduleFlush();
			},
			recordCanvas: true,
			recordCrossOriginIframes: true,
			collectFonts: true,
			inlineImages: true,
			sampling: {
				mousemove: false,
				mouseInteraction: false,
			},
			checkoutEveryNms: 5000,
			recordAfter: "DOMContentLoaded",
			errorHandler(error: unknown) {
				warnings.push(error instanceof Error ? error.message : String(error));
				scheduleFlush();
			},
		});
	} catch (error) {
		warnings.push(error instanceof Error ? error.message : String(error));
		flush("error");
	}

	window.addEventListener("pagehide", () => flush("pagehide"));
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") {
			flush("visibilitychange");
		}
	});
}

function createRecordingId(pageId: string, index: number): string {
	return index === 1 ? pageId : `${pageId}-${index}`;
}

function isRrwebFlushPayload(payload: unknown): payload is RrwebFlushPayload {
	if (!payload || typeof payload !== "object") return false;
	const candidate = payload as Partial<RrwebFlushPayload>;
	return (
		typeof candidate.documentId === "string" &&
		typeof candidate.href === "string" &&
		Array.isArray(candidate.events) &&
		candidate.events.every(
			(event) =>
				Boolean(event) &&
				typeof event === "object" &&
				typeof (event as { timestamp?: unknown }).timestamp === "number",
		)
	);
}
