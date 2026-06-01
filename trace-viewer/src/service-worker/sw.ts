/**
 * Service Worker for extracting ZIP traces and serving screenshots lazily.
 *
 * OTLP trace data is returned to the page during LOAD_TRACE. Screenshots stay
 * cached here and are exposed through the screenshot read API only.
 */

/// <reference lib="webworker" />

import type { Entry, FileEntry } from "@zip.js/zip.js";
import { BlobReader, BlobWriter, TextWriter, ZipReader } from "@zip.js/zip.js";
import {
	mergeOtlpExports,
	parseOtlpExport,
	type OtlpExport,
} from "../trace-data-loader/otlp";

const sw = self as unknown as ServiceWorkerGlobalScope;

interface ScreenshotMeta {
	timestamp: number;
	file: string;
}

interface ZipLoadResult {
	traceId: string;
	traceData: OtlpExport;
	screenshotMetas: ScreenshotMeta[];
	screenshotFiles: Set<string>;
}

interface LoadedTrace {
	traceId: string;
	zip: Blob;
	screenshotFiles: Set<string>;
	screenshotBlobs: Map<string, Blob>;
	screenshotLoads: Map<string, Promise<Blob>>;
	screenshotMetas: ScreenshotMeta[];
}

let currentTrace: LoadedTrace | null = null;

function getBasePath(): string {
	const base = import.meta.env.VITE_TRACE_VIEWER_BASE ?? "/";
	return base.endsWith("/") ? base : `${base}/`;
}

sw.addEventListener("install", () => {
	sw.skipWaiting();
});

sw.addEventListener("activate", (event: ExtendableEvent) => {
	event.waitUntil(sw.clients.claim());
});

sw.addEventListener("message", (event: ExtendableMessageEvent) => {
	const { type, data } = event.data;
	const client = event.source as Client | null;

	switch (type) {
		case "LOAD_TRACE": {
			event.waitUntil(loadTrace(data.zip, client));
			break;
		}

		case "UNLOAD_TRACE": {
			currentTrace = null;
			break;
		}

		case "PING": {
			client?.postMessage({ type: "PONG" });
			break;
		}
	}
});

async function loadTrace(zip: Blob, client: Client | null): Promise<void> {
	try {
		const result = await loadZip(zip);
		currentTrace = {
			traceId: result.traceId,
			zip,
			screenshotFiles: result.screenshotFiles,
			screenshotBlobs: new Map(),
			screenshotLoads: new Map(),
			screenshotMetas: result.screenshotMetas,
		};

		client?.postMessage({
			type: "TRACE_LOADED",
			data: {
				traceId: result.traceId,
				traceData: result.traceData,
				screenshotMetas: result.screenshotMetas,
			},
		});
	} catch (error) {
		client?.postMessage({
			type: "TRACE_LOAD_ERROR",
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

sw.addEventListener("fetch", (event: FetchEvent) => {
	const url = new URL(event.request.url);

	if (!currentTrace) {
		return;
	}

	const apiPrefix = `${getBasePath()}playwright-otel-trace-viewer/v1/${currentTrace.traceId}/`;
	if (!url.pathname.startsWith(apiPrefix)) {
		return;
	}

	const apiPath = url.pathname.slice(apiPrefix.length);
	const parts = apiPath.split("/").filter(Boolean);

	if (parts.length === 1 && parts[0] === "screenshots") {
		event.respondWith(jsonResponse({ screenshots: currentTrace.screenshotMetas }));
		return;
	}

	if (parts.length === 2 && parts[0] === "screenshots") {
		const screenshotFilename = parts[1];
		event.respondWith(screenshotResponse(currentTrace, screenshotFilename));
		return;
	}

	event.respondWith(notFoundResponse(`Unsupported trace API path: ${apiPath}`));
});

async function loadZip(zip: Blob): Promise<ZipLoadResult> {
	const zipReader = new ZipReader(new BlobReader(zip));
	try {
		return await parseZipEntries(await zipReader.getEntries());
	} finally {
		await zipReader.close();
	}
}

async function parseZipEntries(entries: Entry[]): Promise<ZipLoadResult> {
	const traceExports: OtlpExport[] = [];
	const screenshotMetas: ScreenshotMeta[] = [];
	const screenshotFiles = new Set<string>();

	for (const entry of entries) {
		if (!isFileEntry(entry)) continue;

		if (entry.filename.startsWith("traces/") && entry.filename.endsWith(".json")) {
			const name = entry.filename.slice("traces/".length);
			if (name && !name.includes("/")) {
				const text = await entry.getData(new TextWriter());
				traceExports.push(parseOtlpExport(JSON.parse(text)));
			}
		}

		if (entry.filename.startsWith("screenshots/")) {
			const name = entry.filename.slice("screenshots/".length);
			if (name) {
				screenshotFiles.add(name);
				screenshotMetas.push({
					timestamp: extractTimestampFromFilename(name),
					file: name,
				});
			}
		}
	}

	if (traceExports.length === 0) {
		throw new Error(
			"No trace files found in traces/. Make sure you're loading a valid Playwright OpenTelemetry trace ZIP.",
		);
	}

	const traceData = mergeOtlpExports(traceExports);
	const traceId = findTraceId(traceData);
	if (!traceId) {
		throw new Error("Unable to load ZIP trace: no traceId found in OTLP trace data");
	}

	screenshotMetas.sort((a, b) => a.timestamp - b.timestamp);

	return { traceId, traceData, screenshotMetas, screenshotFiles };
}

async function screenshotResponse(
	trace: LoadedTrace,
	filename: string,
): Promise<Response> {
	if (!trace.screenshotFiles.has(filename)) {
		return notFoundResponse(`Screenshot not found: ${filename}`);
	}

	try {
		return blobResponse(await getScreenshotBlob(trace, filename));
	} catch (error) {
		return new Response(
			error instanceof Error ? error.message : String(error),
			{ status: 500 },
		);
	}
}

async function getScreenshotBlob(
	trace: LoadedTrace,
	filename: string,
): Promise<Blob> {
	const cached = trace.screenshotBlobs.get(filename);
	if (cached) return cached;

	const existingLoad = trace.screenshotLoads.get(filename);
	if (existingLoad) return existingLoad;

	const load = extractScreenshotBlob(trace.zip, filename)
		.then((blob) => {
			trace.screenshotBlobs.set(filename, blob);
			return blob;
		})
		.finally(() => {
			trace.screenshotLoads.delete(filename);
		});

	trace.screenshotLoads.set(filename, load);
	return load;
}

async function extractScreenshotBlob(zip: Blob, filename: string): Promise<Blob> {
	const zipReader = new ZipReader(new BlobReader(zip));
	try {
		const entry = (await zipReader.getEntries()).find(
			(entry): entry is FileEntry =>
				isFileEntry(entry) && entry.filename === `screenshots/${filename}`,
		);

		if (!entry) {
			throw new Error(`Screenshot not found in ZIP: ${filename}`);
		}

		return entry.getData(new BlobWriter(getMimeType(filename)));
	} finally {
		await zipReader.close();
	}
}

function findTraceId(traceData: OtlpExport): string | undefined {
	for (const resourceSpans of traceData.resourceSpans) {
		for (const scopeSpans of resourceSpans.scopeSpans) {
			const span = scopeSpans.spans.find((span) => span.traceId);
			if (span) return span.traceId;
		}
	}
	return undefined;
}

function jsonResponse(data: unknown): Response {
	return new Response(JSON.stringify(data), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "no-cache",
		},
	});
}

function blobResponse(blob: Blob): Response {
	return new Response(blob, {
		status: 200,
		headers: {
			"Content-Type": blob.type || "image/jpeg",
			"Cache-Control": "no-cache",
		},
	});
}

function notFoundResponse(message: string): Response {
	return new Response(message, { status: 404 });
}

function extractTimestampFromFilename(filename: string): number {
	const lastDashIndex = filename.lastIndexOf("-");
	if (lastDashIndex === -1) return 0;

	const timestamp = Number.parseInt(
		filename.slice(lastDashIndex + 1).replace(/\.[^.]+$/, ""),
		10,
	);
	return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getMimeType(filename: string): string {
	const ext = filename.split(".").pop()?.toLowerCase();
	switch (ext) {
		case "png":
			return "image/png";
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "webp":
			return "image/webp";
		default:
			return "application/octet-stream";
	}
}

function isFileEntry(entry: Entry): entry is FileEntry {
	return !entry.directory;
}
