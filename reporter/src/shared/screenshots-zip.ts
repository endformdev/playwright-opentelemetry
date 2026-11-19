import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { FileEntry } from "@zip.js/zip.js";
import {
	BlobReader,
	BlobWriter,
	TextWriter,
	ZipReader,
	ZipWriter,
} from "@zip.js/zip.js";

/**
 * The fixture attaches the screenshots ZIP's file name under this name, not
 * the ZIP, which Playwright would copy into its trace and HTML report.
 */
export const SCREENSHOTS_ATTACHMENT_NAME =
	"playwright-opentelemetry-screenshots";

const SCREENSHOTS_ZIP_FILE_NAME =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.zip$/;

/**
 * The project's output directory, which Playwright clears at the start of a
 * run, not the test's, which it can remove before the reporter reads the ZIP.
 */
export function screenshotsZipDir(projectOutputDir: string): string {
	return path.join(projectOutputDir, ".playwright-opentelemetry-screenshots");
}

export async function writeScreenshotsZip(
	projectOutputDir: string,
	zip: Blob,
): Promise<string> {
	const zipDir = screenshotsZipDir(projectOutputDir);
	const fileName = `${randomUUID()}.zip`;
	await fs.mkdir(zipDir, { recursive: true });
	await fs.writeFile(
		path.join(zipDir, fileName),
		Buffer.from(await zip.arrayBuffer()),
	);
	return fileName;
}

/** Only accepts names the fixture makes, since the reporter deletes the file. */
export function parseScreenshotsZipPath(
	projectOutputDir: string,
	fileName: string | null,
): string | null {
	if (!fileName || !SCREENSHOTS_ZIP_FILE_NAME.test(fileName)) {
		return null;
	}

	return path.join(screenshotsZipDir(projectOutputDir), fileName);
}

const MANIFEST_PATH = "manifest.json";
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

export async function createScreenshotsZip(
	screenshots: ScreenshotResource[],
): Promise<Blob> {
	const zipWriter = new ZipWriter(new BlobWriter("application/zip"));
	await addScreenshotsToZip(zipWriter, screenshots);
	return zipWriter.close();
}

/**
 * Add the manifest and frames of a screenshots ZIP to another ZIP, so the same
 * layout can be uploaded on its own or embedded in a local trace ZIP.
 */
export async function addScreenshotsToZip(
	zipWriter: ZipWriter<Blob>,
	screenshots: ScreenshotResource[],
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
}

export async function readScreenshotsZip(
	zipBlob: Blob,
): Promise<ScreenshotResource[]> {
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

		return await Promise.all(
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
	} finally {
		await zipReader.close();
	}
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
