import type { Entry, FileEntry } from "@zip.js/zip.js";
import { BlobReader, BlobWriter, TextWriter, ZipReader } from "@zip.js/zip.js";
import { type Accessor, createMemo, createRoot, createSignal } from "solid-js";
import {
	type OtlpExport,
	type OtlpSpan,
	parseOtlpExport,
} from "../../trace-data-loader";
import type {
	ScreenshotInfo,
	TestInfo,
	TestStatus,
	TraceInfoData,
} from "../TraceInfoLoader";

/** How often a running trace's end moves to now. */
const NOW_TICK_MS = 1000;

/** Sent by the live trace routes in `trace.started`. */
interface LiveTraceStarted {
	traceId: string;
	test: {
		title: string;
		file: string;
		line: number;
		describes: string[];
	};
	/** Epoch milliseconds */
	startTime: number;
}

/** Sent by the live trace routes in `trace.ended`. */
interface LiveTraceEnded {
	status: string;
	/** Epoch milliseconds */
	endTime: number;
}

interface FramesManifest {
	screenshots: Array<{
		timestamp: number;
		path: string;
		contentType: string;
		pageId: string;
	}>;
}

export interface LiveTraceSession {
	testInfo: Accessor<TestInfo>;
	traceData: Accessor<OtlpExport>;
	screenshots: Accessor<ScreenshotInfo[]>;
	close(): void;
}

/**
 * Connects to a live trace's event stream. Resolves once the stream has
 * replayed `trace.started`; everything after that, including what happened
 * before the viewer connected, arrives through the returned session.
 */
export function loadLiveTrace(
	baseUrl: string,
	traceToken: string | null,
): Promise<TraceInfoData> {
	const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

	return new Promise((resolve, reject) => {
		createRoot((dispose) => {
			const [started, setStarted] = createSignal<LiveTraceStarted>();
			const [ended, setEnded] = createSignal<LiveTraceEnded>();
			const [resourceSpans, setResourceSpans] = createSignal<
				OtlpExport["resourceSpans"]
			>([]);
			const [screenshots, setScreenshots] = createSignal<ScreenshotInfo[]>([]);
			const [now, setNow] = createSignal(Date.now());
			const seenSpanIds = new Set<string>();
			const objectUrls: string[] = [];

			const tick = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
			const events = new EventSource(
				withTraceToken(`${normalizedBaseUrl}/stream?offset=-1`, traceToken),
			);

			const close = () => {
				clearInterval(tick);
				events.close();
				for (const url of objectUrls) URL.revokeObjectURL(url);
				dispose();
			};

			const traceData = createMemo((): OtlpExport => ({
				resourceSpans: resourceSpans(),
			}));
			const spanBounds = createMemo(() => spanTimeBounds(resourceSpans()));
			const testInfoOrUndefined = createMemo((): TestInfo | undefined => {
				const start = started();
				if (!start) return undefined;
				const finished = ended();
				const bounds = spanBounds();
				const startMs = Math.min(start.startTime, bounds.startMs);
				const endMs = Math.max(
					finished ? finished.endTime : now(),
					bounds.endMs,
				);

				return {
					name: start.test.title,
					describes: start.test.describes,
					file: start.test.file,
					line: start.test.line,
					status: finished ? toTestStatus(finished.status) : "running",
					traceId: start.traceId,
					startTimeUnixNano: msToNano(startMs),
					endTimeUnixNano: msToNano(endMs),
				};
			});

			// Only read once trace.started has arrived.
			const testInfo = () => testInfoOrUndefined()!;

			const session: LiveTraceSession = {
				testInfo,
				traceData,
				screenshots,
				close,
			};

			events.addEventListener("trace.started", (event) => {
				setStarted(JSON.parse(event.data) as LiveTraceStarted);
				resolve({
					testInfo: testInfo(),
					traceData: traceData(),
					loadScreenshots: async () => screenshots(),
					live: session,
				});
			});

			events.addEventListener("spans", (event) => {
				const spans = newSpans(JSON.parse(event.data), seenSpanIds);
				if (spans) setResourceSpans((current) => [...current, ...spans]);
			});

			events.addEventListener("frames", (event) => {
				const { file } = JSON.parse(event.data) as { file: string };
				loadFrames(
					withTraceToken(`${normalizedBaseUrl}/frames/${file}`, traceToken),
				)
					.then((frames) => {
						objectUrls.push(...frames.map((frame) => frame.url));
						setScreenshots((current) =>
							[...current, ...frames].sort((a, b) => a.timestamp - b.timestamp),
						);
					})
					.catch((error: unknown) => {
						console.warn(`Failed to load live screenshots: ${String(error)}`);
					});
			});

			events.addEventListener("trace.ended", (event) => {
				setEnded(JSON.parse(event.data) as LiveTraceEnded);
				clearInterval(tick);
			});

			events.addEventListener("error", () => {
				// Before trace.started the trace doesn't exist (yet); after it,
				// EventSource reconnects by itself from the last event it saw.
				if (!started() && events.readyState === EventSource.CLOSED) {
					close();
					reject(new Error(`Live trace not found at ${normalizedBaseUrl}`));
				}
			});
		});
	});
}

/** Drops spans already received, for example after a reconnect. */
function newSpans(
	payload: unknown,
	seenSpanIds: Set<string>,
): OtlpExport["resourceSpans"] | undefined {
	let parsed: OtlpExport;
	try {
		parsed = parseOtlpExport(payload);
	} catch (error) {
		console.warn(`Ignoring invalid live spans: ${String(error)}`);
		return undefined;
	}

	const resourceSpans = parsed.resourceSpans.flatMap((resourceSpan) => {
		const scopeSpans = resourceSpan.scopeSpans.flatMap((scopeSpan) => {
			const spans = scopeSpan.spans.filter((span) => {
				if (seenSpanIds.has(span.spanId)) return false;
				seenSpanIds.add(span.spanId);
				return true;
			});
			return spans.length > 0 ? [{ ...scopeSpan, spans }] : [];
		});
		return scopeSpans.length > 0 ? [{ ...resourceSpan, scopeSpans }] : [];
	});

	return resourceSpans.length > 0 ? resourceSpans : undefined;
}

async function loadFrames(url: string): Promise<ScreenshotInfo[]> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`${url}: ${response.status}`);
	}

	const zipReader = new ZipReader(new BlobReader(await response.blob()));
	try {
		const entries = await zipReader.getEntries();
		const manifestEntry = entries.find(
			(entry): entry is FileEntry =>
				isFileEntry(entry) && entry.filename === "manifest.json",
		);
		if (!manifestEntry) return [];

		const manifest = JSON.parse(
			await manifestEntry.getData(new TextWriter()),
		) as FramesManifest;

		return Promise.all(
			manifest.screenshots.flatMap((screenshot) => {
				const entry = entries.find(
					(candidate): candidate is FileEntry =>
						isFileEntry(candidate) && candidate.filename === screenshot.path,
				);
				if (!entry) return [];

				return entry
					.getData(new BlobWriter(screenshot.contentType))
					.then((blob) => ({
						timestamp: screenshot.timestamp,
						url: URL.createObjectURL(blob),
						pageId: screenshot.pageId,
					}));
			}),
		);
	} finally {
		await zipReader.close();
	}
}

function isFileEntry(entry: Entry): entry is FileEntry {
	return !entry.directory;
}

function spanTimeBounds(resourceSpans: OtlpExport["resourceSpans"]): {
	startMs: number;
	endMs: number;
} {
	let startMs = Number.POSITIVE_INFINITY;
	let endMs = Number.NEGATIVE_INFINITY;
	for (const resourceSpan of resourceSpans) {
		for (const scopeSpan of resourceSpan.scopeSpans) {
			for (const span of scopeSpan.spans as OtlpSpan[]) {
				startMs = Math.min(startMs, nanoToMs(span.startTimeUnixNano));
				endMs = Math.max(endMs, nanoToMs(span.endTimeUnixNano));
			}
		}
	}
	return { startMs, endMs };
}

function toTestStatus(status: string): TestStatus {
	switch (status) {
		case "passed":
		case "failed":
		case "skipped":
		case "timedOut":
		case "interrupted":
			return status;
		default:
			// An abandoned trace never reported how its test ended.
			return "interrupted";
	}
}

function withTraceToken(url: string, traceToken: string | null): string {
	if (traceToken === null) return url;
	const separator = url.includes("?") ? "&" : "?";
	return `${url}${separator}traceToken=${encodeURIComponent(traceToken)}`;
}

function nanoToMs(nanos: string): number {
	return Number(BigInt(nanos) / 1_000_000n);
}

function msToNano(ms: number): string {
	return (BigInt(Math.round(ms)) * 1_000_000n).toString();
}
