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
	path: string;
	contentType: string;
	contextId: string;
	pageId: string;
}

interface ScreenshotManifestV2 {
	version: 2;
	screenshots: ScreenshotMeta[];
}

interface ScreenshotManifestV1Entry {
	timestamp?: number;
	file?: string;
	path?: string;
	contentType?: string;
}

interface ScreenshotManifestV1 {
	version?: 1;
	screenshots?: ScreenshotManifestV1Entry[];
}

interface ZipLoadResult {
	traceId: string;
	traceData: OtlpExport;
	screenshotMetas: ScreenshotMeta[];
}

interface LoadedTrace {
	traceId: string;
	zip: Blob;
	screenshotMetasByFile: Map<string, ScreenshotMeta>;
	screenshotBlobs: Map<string, Blob>;
	screenshotLoads: Map<string, Promise<Blob>>;
	screenshotMetas: ScreenshotMeta[];
}

type LoadedScreenshots = LoadedTrace;

const loadedScreenshotsBySource = new Map<string, Promise<LoadedScreenshots>>();
let currentTrace: LoadedScreenshots | null = null;

const scopePath = new URL(sw.registration.scope).pathname;

sw.addEventListener("install", () => {
	sw.skipWaiting();
});

sw.addEventListener("activate", (event: ExtendableEvent) => {
	event.waitUntil(sw.clients.claim());
});

sw.addEventListener("message", (event: ExtendableMessageEvent) => {
	const { requestId, type, data } = event.data;
	const client = event.source as Client | null;

	switch (type) {
		case "LOAD_TRACE": {
			event.waitUntil(loadTrace(data.zip, data.sourceId, client, requestId));
			break;
		}

		case "LOAD_TRACE_ZIP_URL": {
			event.waitUntil(loadTraceZipUrl(data.zipUrl, client, requestId));
			break;
		}

		case "LOAD_SCREENSHOTS": {
			event.waitUntil(
				loadScreenshotsUrl(
					data.traceId,
					data.screenshotsZipUrl,
					client,
					requestId,
				),
			);
			break;
		}

		case "LOAD_SCREENSHOTS_ZIP": {
			event.waitUntil(
				loadScreenshotsZip(
					data.traceId,
					data.zip,
					undefined,
					client,
					requestId,
				),
			);
			break;
		}

		case "UNLOAD_TRACE": {
			currentTrace = null;
			break;
		}

		case "CLEAR_SCREENSHOT_STATE": {
			currentTrace = null;
			loadedScreenshotsBySource.clear();
			client?.postMessage({ requestId, type: "SCREENSHOT_STATE_CLEARED" });
			break;
		}

		case "PING": {
			client?.postMessage({ requestId, type: "PONG" });
			break;
		}
	}
});

async function loadTrace(
	zip: Blob,
	sourceId: string | undefined,
	client: Client | null,
	requestId?: string,
): Promise<void> {
	try {
		const result = await loadZip(zip);
		const loadedTrace = {
			traceId: result.traceId,
			zip,
			screenshotMetasByFile: metasByFile(result.screenshotMetas),
			screenshotBlobs: new Map(),
			screenshotLoads: new Map(),
			screenshotMetas: result.screenshotMetas,
		};
		currentTrace = loadedTrace;
		if (sourceId) {
			loadedScreenshotsBySource.set(
				sourceKey("traceSource", sourceId),
				Promise.resolve(loadedTrace),
			);
		}

		client?.postMessage({
			requestId,
			type: "TRACE_LOADED",
			data: {
				traceId: result.traceId,
				traceData: result.traceData,
				screenshotMetas: result.screenshotMetas,
			},
		});
	} catch (error) {
		client?.postMessage({
			requestId,
			type: "TRACE_LOAD_ERROR",
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function loadTraceZipUrl(
	zipUrl: string,
	client: Client | null,
	requestId?: string,
): Promise<void> {
	try {
		const loadedTrace = await getOrLoadZipScreenshots(zipUrl);
		const result = await loadZip(loadedTrace.zip);

		client?.postMessage({
			requestId,
			type: "TRACE_LOADED",
			data: {
				traceId: result.traceId,
				traceData: result.traceData,
				screenshotMetas: loadedTrace.screenshotMetas,
			},
		});
	} catch (error) {
		client?.postMessage({
			requestId,
			type: "TRACE_LOAD_ERROR",
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function loadScreenshotsUrl(
	traceId: string,
	screenshotsZipUrl: string,
	client: Client | null,
	requestId?: string,
): Promise<void> {
	try {
		const loadedScreenshots = await getOrLoadScreenshotsZip(
			traceId,
			screenshotsZipUrl,
		);

		client?.postMessage({
			requestId,
			type: "SCREENSHOTS_LOADED",
			data: { screenshotMetas: loadedScreenshots.screenshotMetas },
		});
	} catch (error) {
		client?.postMessage({
			requestId,
			type: "SCREENSHOTS_LOAD_ERROR",
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function loadScreenshotsZip(
	traceId: string,
	zip: Blob,
	sourceId: string | undefined,
	client: Client | null,
	requestId?: string,
): Promise<void> {
	try {
		const screenshotMetas = await loadScreenshotMetas(zip);
		const loadedScreenshots = {
			traceId,
			zip,
			screenshotMetasByFile: metasByFile(screenshotMetas),
			screenshotBlobs: new Map(),
			screenshotLoads: new Map(),
			screenshotMetas,
		};
		currentTrace = loadedScreenshots;
		if (sourceId) {
			loadedScreenshotsBySource.set(
				sourceKey("traceSource", sourceId),
				Promise.resolve(loadedScreenshots),
			);
		}

		client?.postMessage({
			requestId,
			type: "SCREENSHOTS_LOADED",
			data: { screenshotMetas },
		});
	} catch (error) {
		client?.postMessage({
			requestId,
			type: "SCREENSHOTS_LOAD_ERROR",
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

sw.addEventListener("fetch", (event: FetchEvent) => {
	const url = new URL(event.request.url);
	const relativePath = relativePathForUrl(url);

	if (!relativePath) {
		return;
	}

	const apiPrefix = "/playwright-otel-trace-viewer/v1/";
	if (!relativePath.startsWith(apiPrefix)) {
		return;
	}

	const apiPath = relativePath.slice(apiPrefix.length);
	const parts = apiPath.split("/").filter(Boolean);
	const traceId = parts[0];
	if (!traceId) {
		event.respondWith(
			notFoundResponse(`Unsupported trace API path: ${apiPath}`),
		);
		return;
	}

	if (parts.length === 2 && parts[1] === "screenshots") {
		event.respondWith(screenshotListResponse(traceId, url));
		return;
	}

	if (parts.length === 3 && parts[1] === "screenshots") {
		const screenshotFilename = decodeURIComponent(parts[2]);
		event.respondWith(
			screenshotResponseForUrl(traceId, screenshotFilename, url),
		);
		return;
	}

	event.respondWith(notFoundResponse(`Unsupported trace API path: ${apiPath}`));
});

function relativePathForUrl(url: URL): string | undefined {
	if (url.origin !== sw.location.origin) return undefined;
	if (!url.pathname.startsWith(scopePath)) return undefined;
	return url.pathname.substring(scopePath.length - 1);
}

async function screenshotListResponse(
	traceId: string,
	url: URL,
): Promise<Response> {
	const loadedScreenshots = await screenshotsForRequest(traceId, url);
	if (!loadedScreenshots) {
		return notFoundResponse("Screenshot source not found");
	}
	return jsonResponse({ screenshots: loadedScreenshots.screenshotMetas });
}

async function screenshotResponseForUrl(
	traceId: string,
	filename: string,
	url: URL,
): Promise<Response> {
	const loadedScreenshots = await screenshotsForRequest(traceId, url);
	if (!loadedScreenshots) {
		return notFoundResponse("Screenshot source not found");
	}
	return screenshotResponse(loadedScreenshots, filename);
}

async function screenshotsForRequest(
	traceId: string,
	url: URL,
): Promise<LoadedScreenshots | undefined> {
	const screenshotsZipUrl = url.searchParams.get("screenshotsZip");
	if (screenshotsZipUrl) {
		return getOrLoadScreenshotsZip(traceId, screenshotsZipUrl);
	}

	const traceZipUrl = url.searchParams.get("traceZip");
	if (traceZipUrl) {
		return getOrLoadZipScreenshots(traceZipUrl);
	}

	const traceSource = url.searchParams.get("traceSource");
	if (traceSource) {
		return loadedScreenshotsBySource.get(sourceKey("traceSource", traceSource));
	}

	return currentTrace?.traceId === traceId ? currentTrace : undefined;
}

function getOrLoadScreenshotsZip(
	traceId: string,
	screenshotsZipUrl: string,
): Promise<LoadedScreenshots> {
	const key = sourceKey("screenshotsZip", screenshotsZipUrl);
	const existing = loadedScreenshotsBySource.get(key);
	if (existing) return existing;

	const promise = fetchZip(screenshotsZipUrl)
		.then((zip) => {
			if (!zip) {
				loadedScreenshotsBySource.delete(key);
				return missingScreenshots(traceId);
			}
			return loadScreenshotsFromZip(traceId, zip);
		})
		.catch((error) => {
			loadedScreenshotsBySource.delete(key);
			throw error;
		});
	loadedScreenshotsBySource.set(key, promise);
	return promise;
}

function getOrLoadZipScreenshots(zipUrl: string): Promise<LoadedScreenshots> {
	const key = sourceKey("traceZip", zipUrl);
	const existing = loadedScreenshotsBySource.get(key);
	if (existing) return existing;

	const promise = fetchZip(zipUrl)
		.then(async (zip) => {
			if (!zip) throw new Error(`Trace ZIP not found: ${zipUrl}`);
			const result = await loadZip(zip);
			return loadedScreenshotsFromMetas(
				result.traceId,
				zip,
				result.screenshotMetas,
			);
		})
		.catch((error) => {
			loadedScreenshotsBySource.delete(key);
			throw error;
		});
	loadedScreenshotsBySource.set(key, promise);
	return promise;
}

async function fetchZip(url: string): Promise<Blob | undefined> {
	const response = await fetch(url);
	if (response.status === 404) return undefined;
	if (!response.ok) {
		throw new Error(`Failed to fetch ZIP from ${url}: ${response.statusText}`);
	}
	return response.blob();
}

function missingScreenshots(traceId: string): LoadedScreenshots {
	return loadedScreenshotsFromMetas(
		traceId,
		new Blob([], { type: "application/zip" }),
		[],
	);
}

async function loadScreenshotsFromZip(
	traceId: string,
	zip: Blob,
): Promise<LoadedScreenshots> {
	return loadedScreenshotsFromMetas(
		traceId,
		zip,
		await loadScreenshotMetas(zip),
	);
}

function loadedScreenshotsFromMetas(
	traceId: string,
	zip: Blob,
	screenshotMetas: ScreenshotMeta[],
): LoadedScreenshots {
	return {
		traceId,
		zip,
		screenshotMetasByFile: metasByFile(screenshotMetas),
		screenshotBlobs: new Map(),
		screenshotLoads: new Map(),
		screenshotMetas,
	};
}

function sourceKey(
	kind: "screenshotsZip" | "traceZip" | "traceSource",
	value: string,
): string {
	return `${kind}:${value}`;
}

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
	const screenshotMetas = await parseScreenshotManifest(entries);

	for (const entry of entries) {
		if (!isFileEntry(entry)) continue;

		if (
			entry.filename.startsWith("traces/") &&
			entry.filename.endsWith(".json")
		) {
			const name = entry.filename.slice("traces/".length);
			if (name && !name.includes("/")) {
				const text = await entry.getData(new TextWriter());
				traceExports.push(parseOtlpExport(JSON.parse(text)));
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
		throw new Error(
			"Unable to load ZIP trace: no traceId found in OTLP trace data",
		);
	}

	return { traceId, traceData, screenshotMetas };
}

async function loadScreenshotMetas(zip: Blob): Promise<ScreenshotMeta[]> {
	const zipReader = new ZipReader(new BlobReader(zip));
	try {
		return parseScreenshotManifest(await zipReader.getEntries());
	} finally {
		await zipReader.close();
	}
}

async function parseScreenshotManifest(
	entries: Entry[],
): Promise<ScreenshotMeta[]> {
	const manifestEntry = entries.find(
		(entry): entry is FileEntry =>
			isFileEntry(entry) && entry.filename === "manifest.json",
	);
	if (!manifestEntry) return [];

	const manifest = parseScreenshotManifestJson(
		JSON.parse(await manifestEntry.getData(new TextWriter())),
	);
	return manifest.screenshots.sort((a, b) => a.timestamp - b.timestamp);
}

function parseScreenshotManifestJson(value: unknown): ScreenshotManifestV2 {
	if (!isObject(value)) {
		throw new Error("Invalid screenshot manifest: expected object");
	}

	if (value.version === 2) {
		return parseScreenshotManifestV2(value);
	}

	if (value.version === 1 || value.version === undefined) {
		return parseScreenshotManifestV2(upgradeScreenshotManifestV1ToV2(value));
	}

	throw new Error(
		`Unsupported screenshot manifest version: ${String(value.version)}`,
	);
}

function parseScreenshotManifestV2(value: unknown): ScreenshotManifestV2 {
	if (!isObject(value)) {
		throw new Error("Invalid screenshot manifest v2: expected object");
	}
	if (value.version !== 2) {
		throw new Error("Invalid screenshot manifest v2: expected version 2");
	}
	if (!Array.isArray(value.screenshots)) {
		throw new Error(
			"Invalid screenshot manifest v2: expected screenshots array",
		);
	}

	return {
		version: 2,
		screenshots: value.screenshots.map((screenshot, index) =>
			parseScreenshotManifestV2Entry(screenshot, index),
		),
	};
}

function parseScreenshotManifestV2Entry(
	value: unknown,
	index: number,
): ScreenshotMeta {
	if (!isObject(value)) {
		throw new Error(
			`Invalid screenshot manifest v2 entry at index ${index}: expected object`,
		);
	}

	return {
		timestamp: requiredNumber(value.timestamp, "timestamp", index),
		file: requiredString(value.file, "file", index),
		path: requiredString(value.path, "path", index),
		contentType: requiredString(value.contentType, "contentType", index),
		contextId: requiredString(value.contextId, "contextId", index),
		pageId: requiredString(value.pageId, "pageId", index),
	};
}

function upgradeScreenshotManifestV1ToV2(
	manifest: ScreenshotManifestV1,
): ScreenshotManifestV2 {
	if (!Array.isArray(manifest.screenshots)) {
		throw new Error(
			"Invalid screenshot manifest v1: expected screenshots array",
		);
	}

	return {
		version: 2,
		screenshots: manifest.screenshots.map((screenshot, index) => {
			if (
				typeof screenshot.timestamp !== "number" ||
				typeof screenshot.file !== "string" ||
				screenshot.file.length === 0
			) {
				throw new Error(
					`Invalid screenshot manifest v1 entry at index ${index}: expected timestamp and file`,
				);
			}

			const pageId = extractResourceIdFromFilename(screenshot.file);

			return {
				timestamp: screenshot.timestamp,
				file: screenshot.file,
				path: screenshot.path || `screenshots/${screenshot.file}`,
				contentType: screenshot.contentType || getMimeType(screenshot.file),
				contextId: pageId,
				pageId,
			};
		}),
	};
}

function requiredString(value: unknown, field: string, index: number): string {
	if (typeof value === "string" && value.length > 0) return value;
	throw new Error(
		`Invalid screenshot manifest v2 entry at index ${index}: expected ${field}`,
	);
}

function requiredNumber(value: unknown, field: string, index: number): number {
	if (typeof value === "number") return value;
	throw new Error(
		`Invalid screenshot manifest v2 entry at index ${index}: expected ${field}`,
	);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function extractResourceIdFromFilename(filename: string): string {
	const lastDashIndex = filename.lastIndexOf("-");
	if (lastDashIndex === -1) return "unknown-page";
	return filename.slice(0, lastDashIndex) || "unknown-page";
}

async function screenshotResponse(
	trace: LoadedTrace,
	filename: string,
): Promise<Response> {
	if (!trace.screenshotMetasByFile.has(filename)) {
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

	const load = extractScreenshotBlob(trace, filename)
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

async function extractScreenshotBlob(
	trace: LoadedTrace,
	filename: string,
): Promise<Blob> {
	const screenshotMeta = trace.screenshotMetasByFile.get(filename);
	if (!screenshotMeta) {
		throw new Error(`Screenshot not found in manifest: ${filename}`);
	}

	const zipReader = new ZipReader(new BlobReader(trace.zip));
	try {
		const entry = (await zipReader.getEntries()).find(
			(entry): entry is FileEntry =>
				isFileEntry(entry) && entry.filename === screenshotMeta.path,
		);

		if (!entry) {
			throw new Error(`Screenshot not found in ZIP: ${filename}`);
		}

		return entry.getData(new BlobWriter(screenshotMeta.contentType));
	} finally {
		await zipReader.close();
	}
}

function metasByFile(
	screenshotMetas: ScreenshotMeta[],
): Map<string, ScreenshotMeta> {
	return new Map(screenshotMetas.map((meta) => [meta.file, meta]));
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
