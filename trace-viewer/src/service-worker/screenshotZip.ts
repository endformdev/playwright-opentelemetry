/**
 * Reading screenshots.zip: its manifest, its images and the actions recorded
 * with them. Shared by the service worker and the page, which unpacks the ZIP
 * itself where there's no worker.
 */

import type { Entry, FileEntry } from "@zip.js/zip.js";
import { BlobReader, BlobWriter, TextWriter, ZipReader } from "@zip.js/zip.js";

export interface ScreenshotMeta {
	timestamp: number;
	file: string;
	path: string;
	contentType: string;
	pageId: string;
	/** The page's viewport in CSS pixels when the frame was taken, if known */
	viewportWidth?: number;
	viewportHeight?: number;
}

/** CSS pixels in the page's main viewport, like a frame's viewport size. */
export interface ActionPoint {
	x: number;
	y: number;
}

/** CSS pixels in the page's main viewport, like a frame's viewport size. */
export interface ActionBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A moment Playwright was about to send input to the page. */
export interface TraceActionInput {
	/** Epoch ms */
	time: number;
	/** Where pointer input landed */
	point?: ActionPoint;
	/** The element the input was for */
	box?: ActionBox;
}

/**
 * Something the test did to a page, such as a click or a fill, and where on
 * the page it landed: an entry of the ZIP's actions.json.
 */
export interface TraceAction {
	pageId: string;
	/** Epoch ms when the call ended */
	end: number;
	failed: boolean;
	/** Playwright's call name: "click", "fill", "dragAndDrop", ... */
	method: string;
	/** In time order; never empty */
	inputs: TraceActionInput[];
	/**
	 * Epoch ms at which the last input's element was already measured where
	 * that input has it, before the action could have moved it: the action
	 * didn't scroll to it. Undefined when it did, or when that isn't known.
	 */
	steadySince?: number;
	/**
	 * Epoch ms before which the last input's element can't be taken to have
	 * been where that input has it: the action scrolled to it, or the page
	 * navigated. Undefined when there is no such time.
	 */
	steadyFrom?: number;
	/**
	 * Epoch ms up to which the last input's element was seen to still be where
	 * that input has it; undefined when nothing was measured.
	 */
	steadyUntil?: number;
}

/** What a screenshots ZIP says it holds, without the images themselves. */
export interface ScreenshotsIndex {
	screenshotMetas: ScreenshotMeta[];
	/** Ordered by first input; empty when the ZIP has none */
	actions: TraceAction[];
}

interface ScreenshotManifest {
	version: 3;
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

/**
 * Web workers are off because service workers have none to use, and a worker
 * can't be relied on in a sandboxed page.
 */
export function openZip(zip: Blob): ZipReader<Blob> {
	return new ZipReader(new BlobReader(zip), { useWebWorkers: false });
}

export async function loadScreenshotsIndex(
	zip: Blob,
): Promise<ScreenshotsIndex> {
	const zipReader = openZip(zip);
	try {
		return await parseScreenshotsIndex(await zipReader.getEntries());
	} finally {
		await zipReader.close();
	}
}

export async function parseScreenshotsIndex(
	entries: Entry[],
): Promise<ScreenshotsIndex> {
	return {
		screenshotMetas: await parseScreenshotManifest(entries),
		actions: await parseActions(entries),
	};
}

/**
 * The actions in a ZIP's actions.json. They are an extra: a missing file, or
 * one that can't be read, means no actions rather than an error.
 */
async function parseActions(entries: Entry[]): Promise<TraceAction[]> {
	const actionsEntry = entries.find(
		(entry): entry is FileEntry =>
			isFileEntry(entry) && entry.filename === "actions.json",
	);
	if (!actionsEntry) return [];
	try {
		return parseActionsJson(
			JSON.parse(await actionsEntry.getData(new TextWriter())),
		);
	} catch {
		return [];
	}
}

/**
 * The actions of a parsed actions.json, ordered by first input, without any
 * that aren't in the shape of version 1. Nothing from any other file.
 */
export function parseActionsJson(value: unknown): TraceAction[] {
	if (
		!isObject(value) ||
		value.version !== 1 ||
		!Array.isArray(value.actions)
	) {
		return [];
	}
	return value.actions
		.flatMap((action) => parseAction(action) ?? [])
		.sort((a, b) => a.inputs[0].time - b.inputs[0].time);
}

function parseAction(value: unknown): TraceAction | undefined {
	if (
		!isObject(value) ||
		typeof value.pageId !== "string" ||
		typeof value.method !== "string" ||
		!isFiniteNumber(value.end) ||
		!Array.isArray(value.inputs)
	) {
		return undefined;
	}
	const inputs = value.inputs.flatMap((input) => parseActionInput(input) ?? []);
	if (inputs.length === 0 || inputs.length !== value.inputs.length) {
		return undefined;
	}
	return {
		pageId: value.pageId,
		end: value.end,
		failed: value.failed === true,
		method: value.method,
		inputs: inputs.sort((a, b) => a.time - b.time),
		...(isFiniteNumber(value.steadySince)
			? { steadySince: value.steadySince }
			: {}),
		...(isFiniteNumber(value.steadyFrom)
			? { steadyFrom: value.steadyFrom }
			: {}),
		...(isFiniteNumber(value.steadyUntil)
			? { steadyUntil: value.steadyUntil }
			: {}),
	};
}

function parseActionInput(value: unknown): TraceActionInput | undefined {
	if (!isObject(value) || !isFiniteNumber(value.time)) return undefined;
	const point = hasNumbers(value.point, ["x", "y"])
		? { x: value.point.x, y: value.point.y }
		: undefined;
	const box =
		hasNumbers(value.box, ["x", "y", "width", "height"]) &&
		value.box.width >= 0 &&
		value.box.height >= 0
			? {
					x: value.box.x,
					y: value.box.y,
					width: value.box.width,
					height: value.box.height,
				}
			: undefined;
	if (!point && !box) return undefined;
	return {
		time: value.time,
		...(point ? { point } : {}),
		...(box ? { box } : {}),
	};
}

function hasNumbers<Key extends string>(
	value: unknown,
	keys: Key[],
): value is Record<Key, number> {
	return isObject(value) && keys.every((key) => isFiniteNumber(value[key]));
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

export async function parseScreenshotManifest(
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

function parseScreenshotManifestJson(value: unknown): ScreenshotManifest {
	if (!isObject(value)) {
		throw new Error("Invalid screenshot manifest: expected object");
	}

	// v2 carried a contextId per entry which is no longer used; v3 dropped it.
	if (value.version === 3 || value.version === 2) {
		return parseScreenshotManifestEntries(value);
	}

	if (value.version === 1 || value.version === undefined) {
		return parseScreenshotManifestEntries(upgradeScreenshotManifestV1(value));
	}

	throw new Error(
		`Unsupported screenshot manifest version: ${String(value.version)}`,
	);
}

function parseScreenshotManifestEntries(value: unknown): ScreenshotManifest {
	if (!isObject(value)) {
		throw new Error("Invalid screenshot manifest: expected object");
	}
	if (!Array.isArray(value.screenshots)) {
		throw new Error("Invalid screenshot manifest: expected screenshots array");
	}

	return {
		version: 3,
		screenshots: value.screenshots.map((screenshot, index) =>
			parseScreenshotManifestEntry(screenshot, index),
		),
	};
}

function parseScreenshotManifestEntry(
	value: unknown,
	index: number,
): ScreenshotMeta {
	if (!isObject(value)) {
		throw new Error(
			`Invalid screenshot manifest entry at index ${index}: expected object`,
		);
	}

	return {
		timestamp: requiredNumber(value.timestamp, "timestamp", index),
		file: requiredString(value.file, "file", index),
		path: requiredString(value.path, "path", index),
		contentType: requiredString(value.contentType, "contentType", index),
		pageId: requiredString(value.pageId, "pageId", index),
		...viewportOf(value),
	};
}

/** A frame's viewport, when the manifest has a usable one. */
function viewportOf(
	value: Record<string, unknown>,
): Pick<ScreenshotMeta, "viewportWidth" | "viewportHeight"> {
	const { viewportWidth, viewportHeight } = value;
	return isFiniteNumber(viewportWidth) &&
		isFiniteNumber(viewportHeight) &&
		viewportWidth > 0 &&
		viewportHeight > 0
		? { viewportWidth, viewportHeight }
		: {};
}

function upgradeScreenshotManifestV1(
	manifest: ScreenshotManifestV1,
): ScreenshotManifest {
	if (!Array.isArray(manifest.screenshots)) {
		throw new Error(
			"Invalid screenshot manifest v1: expected screenshots array",
		);
	}

	return {
		version: 3,
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

			return {
				timestamp: screenshot.timestamp,
				file: screenshot.file,
				path: screenshot.path || `screenshots/${screenshot.file}`,
				contentType: screenshot.contentType || getMimeType(screenshot.file),
				pageId: extractResourceIdFromFilename(screenshot.file),
			};
		}),
	};
}

function requiredString(value: unknown, field: string, index: number): string {
	if (typeof value === "string" && value.length > 0) return value;
	throw new Error(
		`Invalid screenshot manifest entry at index ${index}: expected ${field}`,
	);
}

function requiredNumber(value: unknown, field: string, index: number): number {
	if (typeof value === "number") return value;
	throw new Error(
		`Invalid screenshot manifest entry at index ${index}: expected ${field}`,
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

/** The images for `screenshotMetas` by filename, without any the ZIP lacks. */
export async function extractScreenshots(
	zip: Blob,
	screenshotMetas: ScreenshotMeta[],
): Promise<Map<string, Blob>> {
	const zipReader = openZip(zip);
	try {
		const entries = new Map(
			(await zipReader.getEntries())
				.filter(isFileEntry)
				.map((entry) => [entry.filename, entry]),
		);
		const blobs = new Map<string, Blob>();
		for (const { file, path, contentType } of screenshotMetas) {
			const entry = entries.get(path);
			if (!entry) continue;
			blobs.set(file, await entry.getData(new BlobWriter(contentType)));
		}
		return blobs;
	} finally {
		await zipReader.close();
	}
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

export function isFileEntry(entry: Entry): entry is FileEntry {
	return !entry.directory;
}
