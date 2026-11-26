import type { FileEntry } from "@zip.js/zip.js";
import {
	BlobReader,
	BlobWriter,
	TextWriter,
	ZipReader,
	ZipWriter,
} from "@zip.js/zip.js";

/**
 * The fixture attaches captured screencast frames to the test result as a
 * screenshots ZIP under this name; the reporter uploads it and copies it into
 * the local trace ZIP.
 */
export const SCREENSHOTS_ATTACHMENT_NAME =
	"playwright-opentelemetry-screenshots";

const MANIFEST_PATH = "manifest.json";
const ACTIONS_PATH = "actions.json";
const SCREENSHOTS_DIR = "screenshots/";

/**
 * The page's viewport size in CSS pixels when a frame was captured. Frames are
 * scaled down, so this maps page coordinates, such as an action's point, onto
 * the image.
 */
export interface ScreenshotViewport {
	viewportWidth?: number;
	viewportHeight?: number;
}

export interface ScreenshotManifestEntry extends ScreenshotViewport {
	timestamp: number;
	file: string;
	path: string;
	contentType: string;
	pageId: string;
}

export interface ScreenshotManifest {
	version: 3;
	screenshots: ScreenshotManifestEntry[];
}

export interface ScreenshotResource extends ScreenshotViewport {
	timestamp: number;
	file: string;
	contentType: string;
	pageId: string;
	blob: Blob;
}

/** CSS pixels in the page's main viewport, like the frames' viewport size. */
export interface ActionPoint {
	x: number;
	y: number;
}

/** CSS pixels in the page's main viewport, like the frames' viewport size. */
export interface ActionBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A moment Playwright was about to send input to the page. */
export interface ActionInput {
	/** Epoch ms */
	time: number;
	/** Where pointer input landed */
	point?: ActionPoint;
	/** The element the input was for */
	box?: ActionBox;
}

/**
 * A Playwright call that sent input to a page, such as a click or a fill, and
 * where on the page it landed.
 */
export interface RecordedAction {
	/** Same as the screenshots' pageId and the browser.page.id span attribute */
	pageId: string;
	/** Epoch ms when the call ended */
	end: number;
	/** The call failed */
	failed?: true;
	/** Playwright's call name: "click", "fill", "hover", "mouseClick", ... */
	method: string;
	/** In order; never empty */
	inputs: ActionInput[];
	/**
	 * Epoch ms. The element of the last input was measured where that input
	 * has it at this time already, before the action could have moved it: as
	 * the call began for pointer input, at the input otherwise. So the action
	 * didn't scroll to it. Absent when it did, or when that isn't known. Only
	 * recorded in Chromium, where a frame's timestamp is when it was shown:
	 * it's what lets a frame from just after the input be trusted.
	 */
	steadySince?: number;
	/**
	 * Epoch ms. The element of the last input can't be taken to have been
	 * where that input has it any earlier than this: the action scrolled to
	 * it, or the page navigated.
	 */
	steadyFrom?: number;
	/**
	 * Epoch ms. The element of the last input was measured again up to this
	 * time and was still where that input has it. Absent for input without an
	 * element, such as `page.mouse`.
	 */
	steadyUntil?: number;
}

/** `actions.json` in a screenshots ZIP: what the test did to its pages. */
export interface ActionsFile {
	version: 1;
	/** Ordered by the time of their first input */
	actions: RecordedAction[];
}

/** What a screenshots ZIP holds. */
export interface ScreenshotsZipContents {
	screenshots: ScreenshotResource[];
	/** Absent when the test's actions weren't recorded */
	actions?: ActionsFile;
}

export async function createScreenshotsZip(
	screenshots: ScreenshotResource[],
	actions?: ActionsFile,
): Promise<Blob> {
	const zipWriter = new ZipWriter(new BlobWriter("application/zip"));
	await addScreenshotsToZip(zipWriter, screenshots, actions);
	return zipWriter.close();
}

/**
 * Add the manifest, frames and actions of a screenshots ZIP to another ZIP, so
 * the same layout can be uploaded on its own or embedded in a local trace ZIP.
 */
export async function addScreenshotsToZip(
	zipWriter: ZipWriter<Blob>,
	screenshots: ScreenshotResource[],
	actions?: ActionsFile,
): Promise<void> {
	const sorted = [...screenshots].sort((a, b) => a.timestamp - b.timestamp);
	const manifest: ScreenshotManifest = {
		version: 3,
		screenshots: sorted.map((screenshot) => ({
			timestamp: screenshot.timestamp,
			file: screenshot.file,
			path: `${SCREENSHOTS_DIR}${screenshot.file}`,
			contentType: screenshot.contentType,
			pageId: screenshot.pageId,
			...viewportOf(screenshot),
		})),
	};

	await zipWriter.add(
		MANIFEST_PATH,
		new Blob([JSON.stringify(manifest, null, 2)], {
			type: "application/json",
		}).stream(),
	);

	for (const screenshot of sorted) {
		// Frames are already compressed JPEGs; deflating them again only costs time.
		await zipWriter.add(
			`${SCREENSHOTS_DIR}${screenshot.file}`,
			screenshot.blob.stream(),
			{ level: 0 },
		);
	}

	// A file of its own, so the manifest's version stays one every viewer reads.
	if (actions) {
		await zipWriter.add(
			ACTIONS_PATH,
			new Blob([JSON.stringify(actions)], {
				type: "application/json",
			}).stream(),
		);
	}
}

export async function readScreenshotsZip(
	zipBlob: Blob,
): Promise<ScreenshotsZipContents> {
	const zipReader = new ZipReader(new BlobReader(zipBlob));
	try {
		const entries = new Map(
			(await zipReader.getEntries())
				.filter((entry): entry is FileEntry => !entry.directory)
				.map((entry) => [entry.filename, entry]),
		);
		const manifestEntry = entries.get(MANIFEST_PATH);
		if (!manifestEntry) {
			throw new Error(`Screenshots ZIP has no ${MANIFEST_PATH}`);
		}

		const manifest = JSON.parse(
			await manifestEntry.getData(new TextWriter()),
		) as ScreenshotManifest;

		const screenshots = await Promise.all(
			manifest.screenshots.map(async (screenshot) => {
				const entry = entries.get(screenshot.path);
				if (!entry) {
					throw new Error(`Screenshots ZIP has no ${screenshot.path}`);
				}
				return {
					timestamp: screenshot.timestamp,
					file: screenshot.file,
					contentType: screenshot.contentType,
					pageId: screenshot.pageId,
					...viewportOf(screenshot),
					blob: await entry.getData(new BlobWriter(screenshot.contentType)),
				};
			}),
		);
		return {
			screenshots,
			actions: await readActions(entries.get(ACTIONS_PATH)),
		};
	} finally {
		await zipReader.close();
	}
}

/** Actions are an extra: a file that can't be read leaves the screenshots. */
async function readActions(
	entry: FileEntry | undefined,
): Promise<ActionsFile | undefined> {
	if (!entry) {
		return undefined;
	}
	try {
		return parseActionsFile(JSON.parse(await entry.getData(new TextWriter())));
	} catch {
		return undefined;
	}
}

/**
 * The actions of a parsed `actions.json`, without any that aren't in the
 * shape this version writes; undefined for another version or shape of file.
 */
export function parseActionsFile(value: unknown): ActionsFile | undefined {
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		!Array.isArray(value.actions)
	) {
		return undefined;
	}
	return {
		version: 1,
		actions: value.actions.flatMap((action) => parseAction(action) ?? []),
	};
}

function parseAction(value: unknown): RecordedAction | undefined {
	if (
		!isRecord(value) ||
		typeof value.pageId !== "string" ||
		typeof value.method !== "string" ||
		!isFiniteNumber(value.end) ||
		!Array.isArray(value.inputs)
	) {
		return undefined;
	}
	const inputs = value.inputs.flatMap((input) => parseInput(input) ?? []);
	if (inputs.length === 0 || inputs.length !== value.inputs.length) {
		return undefined;
	}
	return {
		pageId: value.pageId,
		end: value.end,
		...(value.failed === true ? { failed: true } : {}),
		method: value.method,
		inputs,
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

function parseInput(value: unknown): ActionInput | undefined {
	if (!isRecord(value) || !isFiniteNumber(value.time)) {
		return undefined;
	}
	const point = isNumbers(value.point, ["x", "y"])
		? { x: value.point.x, y: value.point.y }
		: undefined;
	const box = isNumbers(value.box, ["x", "y", "width", "height"])
		? {
				x: value.box.x,
				y: value.box.y,
				width: value.box.width,
				height: value.box.height,
			}
		: undefined;
	if (!point && !box) {
		return undefined;
	}
	return {
		time: value.time,
		...(point ? { point } : {}),
		...(box ? { box } : {}),
	};
}

function isNumbers<Key extends string>(
	value: unknown,
	keys: Key[],
): value is Record<Key, number> {
	return isRecord(value) && keys.every((key) => isFiniteNumber(value[key]));
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function viewportOf(screenshot: ScreenshotViewport): ScreenshotViewport {
	return screenshot.viewportWidth !== undefined &&
		screenshot.viewportHeight !== undefined
		? {
				viewportWidth: screenshot.viewportWidth,
				viewportHeight: screenshot.viewportHeight,
			}
		: {};
}
