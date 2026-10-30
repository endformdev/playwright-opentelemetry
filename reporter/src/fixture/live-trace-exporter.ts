import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import {
	createScreenshotsZip,
	type ScreenshotResource,
} from "../reporter/trace-zip-builder";
import type {
	ResolvedPlaywrightOpentelemetryConfig,
	ResolvedPlaywrightOpentelemetryDestination,
} from "../shared/config";
import { filterLiveDestinations } from "../shared/destinations";
import {
	type LiveTraceRoute,
	type LiveTraceStarted,
	sendLiveTraceRequest,
} from "../shared/live-trace";
import { buildOtlpRequest } from "../shared/otel";
import type { FixtureSpan, TestTraceContext } from "./trace-context";

const SPAN_FLUSH_INTERVAL_MS = 250;
const FRAME_FLUSH_INTERVAL_MS = 1000;
/** Per page: frames closer together than this are dropped, except the latest. */
const MIN_FRAME_INTERVAL_MS = 250;

interface ScreencastFrame {
	data: Buffer;
	/** Epoch milliseconds */
	timestamp: number;
}

/**
 * Streams a test's completed fixture spans and screenshot frames to live
 * trace destinations while the test runs. Spans are batched for a few hundred
 * milliseconds and frames for about a second, so each becomes one request.
 */
export class LiveTraceExporter {
	private pendingSpans: FixtureSpan[] = [];
	private pendingFrames = new Map<string, ScreenshotResource>();
	private lastKeptFrameAt = new Map<string, number>();
	private latestDroppedFrame = new Map<string, ScreencastFrame>();
	private spanFlushTimer: ReturnType<typeof setTimeout> | undefined;
	private frameFlushTimer: ReturnType<typeof setTimeout> | undefined;
	private inFlight = new Set<Promise<void>>();
	private warned = false;

	private constructor(
		private readonly traceId: string,
		private readonly destinations: ResolvedPlaywrightOpentelemetryDestination[],
	) {}

	/**
	 * Creates the live trace at every live destination. Returns undefined when
	 * there are none, or none accepted it.
	 */
	static async start(
		traceContext: TestTraceContext,
		config: ResolvedPlaywrightOpentelemetryConfig,
		testInfo: TestInfo,
	): Promise<LiveTraceExporter | undefined> {
		const destinations = filterLiveDestinations(
			config.playwrightTraceApiDestinations,
		);
		if (destinations.length === 0) return undefined;

		const started: LiveTraceStarted = {
			traceId: traceContext.traceId,
			rootSpanId: traceContext.rootSpanId,
			test: {
				title: testInfo.title,
				file: path.relative(testInfo.config.rootDir, testInfo.file),
				line: testInfo.line,
				// titlePath starts with the file and ends with the test title.
				describes: testInfo.titlePath.slice(1, -1),
				project: testInfo.project.name,
			},
			startTime: Date.now(),
			screenshots: supportsScreencast(testInfo.config.version),
		};
		const body = JSON.stringify(started);

		const accepted = await Promise.all(
			destinations.map(async (destination) => {
				const failure = await sendLiveTraceRequest(
					destination,
					traceContext.traceId,
					"start",
					body,
				);
				if (failure) {
					console.warn(
						`Live trace ${traceContext.traceId} disabled for a destination: ${failure}`,
					);
					return undefined;
				}
				return destination;
			}),
		);

		const reachable = accepted.filter(
			(
				destination,
			): destination is ResolvedPlaywrightOpentelemetryDestination =>
				destination !== undefined,
		);
		return reachable.length > 0
			? new LiveTraceExporter(traceContext.traceId, reachable)
			: undefined;
	}

	addSpan(span: FixtureSpan): void {
		this.pendingSpans.push(span);
		this.spanFlushTimer ??= setTimeout(
			() => this.flushSpans(),
			SPAN_FLUSH_INTERVAL_MS,
		);
	}

	addFrame(pageId: string, frame: ScreencastFrame): void {
		const lastKeptAt = this.lastKeptFrameAt.get(pageId);
		if (
			lastKeptAt !== undefined &&
			frame.timestamp - lastKeptAt < MIN_FRAME_INTERVAL_MS
		) {
			// Kept for the next flush, so the page's latest state still shows.
			this.latestDroppedFrame.set(pageId, frame);
			this.scheduleFrameFlush();
			return;
		}

		this.keepFrame(pageId, frame);
	}

	/** Sends everything still pending and waits for in-flight requests. */
	async close(): Promise<void> {
		this.flushSpans();
		this.flushFrames();
		await Promise.all(this.inFlight);
	}

	private keepFrame(pageId: string, frame: ScreencastFrame): void {
		this.lastKeptFrameAt.set(pageId, frame.timestamp);
		this.latestDroppedFrame.delete(pageId);

		const file = `${pageId}-${frame.timestamp}.jpeg`;
		this.pendingFrames.set(file, {
			timestamp: frame.timestamp,
			file,
			contentType: "image/jpeg",
			pageId,
			blob: new Blob([new Uint8Array(frame.data)], { type: "image/jpeg" }),
		});
		this.scheduleFrameFlush();
	}

	private scheduleFrameFlush(): void {
		this.frameFlushTimer ??= setTimeout(
			() => this.flushFrames(),
			FRAME_FLUSH_INTERVAL_MS,
		);
	}

	private flushSpans(): void {
		clearTimeout(this.spanFlushTimer);
		this.spanFlushTimer = undefined;
		if (this.pendingSpans.length === 0) return;

		const spans = this.pendingSpans;
		this.pendingSpans = [];
		this.sendToAll(
			"spans",
			Promise.resolve(JSON.stringify(buildOtlpRequest(spans, "unknown"))),
		);
	}

	private flushFrames(): void {
		for (const [pageId, frame] of this.latestDroppedFrame) {
			this.keepFrame(pageId, frame);
		}
		clearTimeout(this.frameFlushTimer);
		this.frameFlushTimer = undefined;
		if (this.pendingFrames.size === 0) return;

		const frames = this.pendingFrames;
		this.pendingFrames = new Map();
		this.sendToAll("frames", createScreenshotsZip(frames));
	}

	private sendToAll(route: LiveTraceRoute, body: Promise<string | Blob>): void {
		const request = body
			.then((resolvedBody) =>
				Promise.all(
					this.destinations.map((destination) =>
						sendLiveTraceRequest(
							destination,
							this.traceId,
							route,
							resolvedBody,
						),
					),
				),
			)
			.then((failures) => {
				const failure = failures.find(Boolean);
				if (failure && !this.warned) {
					this.warned = true;
					console.warn(`Live trace ${this.traceId} export failed: ${failure}`);
				}
			});

		this.inFlight.add(request);
		void request.finally(() => this.inFlight.delete(request));
	}
}

/** `page.screencast` arrived in Playwright 1.59. */
function supportsScreencast(playwrightVersion: string): boolean {
	const [major = 0, minor = 0] = playwrightVersion.split(".").map(Number);
	return major > 1 || (major === 1 && minor >= 59);
}

let warnedMissingScreencast = false;

/**
 * Forwards a page's screencast frames to the live trace, using the frames
 * Playwright already produces for tracing. Returns a function that stops it.
 */
export async function startLiveScreencast(
	page: Page,
	pageId: string,
	live: LiveTraceExporter,
): Promise<() => Promise<void>> {
	if (!("screencast" in page)) {
		if (!warnedMissingScreencast) {
			warnedMissingScreencast = true;
			console.warn(
				"Live trace screenshots need Playwright 1.59 or newer; continuing without them.",
			);
		}
		return async () => {};
	}

	try {
		await page.screencast.start({
			onFrame: (frame) => live.addFrame(pageId, frame),
		});
	} catch (error) {
		console.warn(
			`Live trace screenshots unavailable: ${error instanceof Error ? error.message : String(error)}`,
		);
		return async () => {};
	}

	return () => page.screencast.stop().catch(() => {});
}
