import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import { extractScreenshots, loadScreenshotMetas } from "./screenshotZip";

async function zipOf(files: Record<string, string>): Promise<Blob> {
	const writer = new ZipWriter(new BlobWriter("application/zip"));
	for (const [path, content] of Object.entries(files)) {
		await writer.add(path, new TextReader(content));
	}
	return writer.close();
}

function zipWithManifest(manifest: unknown): Promise<Blob> {
	return zipOf({ "manifest.json": JSON.stringify(manifest) });
}

const screenshot = {
	timestamp: 200,
	file: "page@abc-200.jpeg",
	path: "screenshots/page@abc-200.jpeg",
	contentType: "image/jpeg",
	pageId: "page@abc",
};

describe("reading screenshot manifests", () => {
	it("has no screenshots without a manifest", async () => {
		expect(await loadScreenshotMetas(await zipOf({ other: "file" }))).toEqual(
			[],
		);
	});

	it("reads version 3, in time order", async () => {
		const earlier = { ...screenshot, timestamp: 100, file: "earlier.jpeg" };
		const zip = await zipWithManifest({
			version: 3,
			screenshots: [screenshot, earlier],
		});

		expect(await loadScreenshotMetas(zip)).toEqual([earlier, screenshot]);
	});

	it("reads version 2, dropping its contextId", async () => {
		const zip = await zipWithManifest({
			version: 2,
			screenshots: [{ ...screenshot, contextId: "context-1" }],
		});

		expect(await loadScreenshotMetas(zip)).toEqual([screenshot]);
	});

	it.each([1, undefined])(
		"fills in what version %s left out",
		async (version) => {
			const zip = await zipWithManifest({
				version,
				screenshots: [{ timestamp: 200, file: "page@abc-200.jpeg" }],
			});

			expect(await loadScreenshotMetas(zip)).toEqual([screenshot]);
		},
	);

	it("rejects versions it doesn't know", async () => {
		const zip = await zipWithManifest({ version: 4, screenshots: [] });

		await expect(loadScreenshotMetas(zip)).rejects.toThrow(
			"Unsupported screenshot manifest version: 4",
		);
	});
});

describe("extracting screenshots", () => {
	it("returns images by filename with the manifest's content type", async () => {
		const zip = await zipOf({ [screenshot.path]: "image bytes" });

		const blobs = await extractScreenshots(zip, [screenshot]);

		const blob = blobs.get(screenshot.file);
		expect(blob?.type).toBe("image/jpeg");
		expect(await blob?.text()).toBe("image bytes");
	});

	it("leaves out images the manifest lists but the ZIP lacks", async () => {
		const zip = await zipOf({ [screenshot.path]: "image bytes" });
		const missing = { ...screenshot, file: "gone.jpeg", path: "gone.jpeg" };

		const blobs = await extractScreenshots(zip, [missing, screenshot]);

		expect([...blobs.keys()]).toEqual([screenshot.file]);
	});
});
