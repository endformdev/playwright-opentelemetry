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
const SCREENSHOTS_DIR = "screenshots/";

export interface ScreenshotManifestEntry {
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

export interface ScreenshotResource {
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
					blob: await entry.getData(new BlobWriter(screenshot.contentType)),
				};
			}),
		);
	} finally {
		await zipReader.close();
	}
}
