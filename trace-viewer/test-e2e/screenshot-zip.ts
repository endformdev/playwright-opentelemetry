import { BlobWriter, ZipWriter } from "@zip.js/zip.js";

interface CreateScreenshotsZipOptions {
	testStartTime: number;
	contextCount: number;
	pagesPerContext: number;
}

interface CreateScreenshotsZipFromOffsetsOptions {
	testStartTime: number;
	screenshotOffsetsMs: number[];
	pageId?: string;
}

interface ScreenshotManifestEntry {
	timestamp: number;
	file: string;
	path: string;
	contentType: string;
	pageId: string;
}

export async function createScreenshotsZip({
	testStartTime,
	contextCount,
	pagesPerContext,
}: CreateScreenshotsZipOptions): Promise<Blob> {
	const blobWriter = new BlobWriter("application/zip");
	const zipWriter = new ZipWriter(blobWriter);
	const screenshots: ScreenshotManifestEntry[] = [];

	for (let contextIndex = 1; contextIndex <= contextCount; contextIndex++) {
		const contextLabel = `context-${contextIndex}`;
		for (let pageIndex = 1; pageIndex <= pagesPerContext; pageIndex++) {
			const pageId = `${contextLabel}-page-${pageIndex}`;
			const timestamp = testStartTime + contextIndex * 100 + pageIndex * 10;
			const file = `${pageId}-${timestamp}.svg`;
			const path = `screenshots/${file}`;

			screenshots.push({
				timestamp,
				file,
				path,
				contentType: "image/svg+xml",
				pageId,
			});
			await zipWriter.add(
				path,
				new Blob([screenshotSvg(contextLabel, pageId)], {
					type: "image/svg+xml",
				}).stream(),
			);
		}
	}

	await zipWriter.add(
		"manifest.json",
		new Blob([
			JSON.stringify({
				version: 3,
				screenshots,
			}),
		]).stream(),
	);

	return zipWriter.close();
}

export async function createScreenshotsZipFromOffsets({
	testStartTime,
	screenshotOffsetsMs,
	pageId = "context-1-page-1",
}: CreateScreenshotsZipFromOffsetsOptions): Promise<Blob> {
	const blobWriter = new BlobWriter("application/zip");
	const zipWriter = new ZipWriter(blobWriter);
	const screenshots: ScreenshotManifestEntry[] = [];

	for (const offsetMs of screenshotOffsetsMs) {
		const timestamp = testStartTime + offsetMs;
		const file = `${pageId}-${timestamp}.svg`;
		const path = `screenshots/${file}`;
		screenshots.push({
			timestamp,
			file,
			path,
			contentType: "image/svg+xml",
			pageId,
		});
		await zipWriter.add(
			path,
			new Blob([screenshotSvg("context-1", `${pageId} @ ${offsetMs}ms`)], {
				type: "image/svg+xml",
			}).stream(),
		);
	}

	await zipWriter.add(
		"manifest.json",
		new Blob([
			JSON.stringify({
				version: 3,
				screenshots,
			}),
		]).stream(),
	);

	return zipWriter.close();
}

function screenshotSvg(label: string, pageId: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#dbeafe"/><text x="320" y="165" text-anchor="middle" font-family="Arial, sans-serif" font-size="36" fill="#1e3a8a">${label}</text><text x="320" y="215" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" fill="#1e40af">${pageId}</text></svg>`;
}
