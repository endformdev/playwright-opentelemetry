import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import {
	extractScreenshots,
	loadScreenshotsIndex,
	parseActionsJson,
} from "./screenshotZip";

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
		expect(await loadScreenshotsIndex(await zipOf({ other: "file" }))).toEqual({
			screenshotMetas: [],
			actions: [],
		});
	});

	it("reads version 3, in time order, with optional viewport sizes", async () => {
		const earlier = {
			...screenshot,
			timestamp: 100,
			file: "earlier.jpeg",
			viewportWidth: 1280,
			viewportHeight: 720,
		};
		const zip = await zipWithManifest({
			version: 3,
			screenshots: [screenshot, earlier],
		});

		expect((await loadScreenshotsIndex(zip)).screenshotMetas).toEqual([
			earlier,
			screenshot,
		]);
	});

	it("ignores unusable viewport sizes on manifest entries", async () => {
		const zip = await zipWithManifest({
			version: 3,
			screenshots: [
				{ ...screenshot, viewportWidth: 0, viewportHeight: 720 },
				{ ...screenshot, timestamp: 201, viewportWidth: 1280 },
			],
		});

		expect((await loadScreenshotsIndex(zip)).screenshotMetas).toEqual([
			screenshot,
			{ ...screenshot, timestamp: 201 },
		]);
	});

	it("reads version 2, dropping its contextId", async () => {
		const zip = await zipWithManifest({
			version: 2,
			screenshots: [{ ...screenshot, contextId: "context-1" }],
		});

		expect((await loadScreenshotsIndex(zip)).screenshotMetas).toEqual([
			screenshot,
		]);
	});

	it.each([1, undefined])(
		"fills in what version %s left out",
		async (version) => {
			const zip = await zipWithManifest({
				version,
				screenshots: [{ timestamp: 200, file: "page@abc-200.jpeg" }],
			});

			expect((await loadScreenshotsIndex(zip)).screenshotMetas).toEqual([
				screenshot,
			]);
		},
	);

	it("rejects versions it doesn't know", async () => {
		const zip = await zipWithManifest({ version: 4, screenshots: [] });

		await expect(loadScreenshotsIndex(zip)).rejects.toThrow(
			"Unsupported screenshot manifest version: 4",
		);
	});
});

describe("reading actions.json", () => {
	it("loads actions alongside screenshots, ordered by start time", async () => {
		const second = {
			pageId: "page@abc",
			start: 200,
			end: 240,
			method: "click",
			point: { x: 10, y: 20 },
			box: { x: 0, y: 0, width: 40, height: 30 },
			failed: true,
		};
		const first = {
			pageId: "page@abc",
			start: 100,
			end: 150,
			method: "dragAndDrop",
			point: { x: 80, y: 90 },
			dragFrom: { x: 10, y: 20 },
		};
		const zip = await zipOf({
			"manifest.json": JSON.stringify({
				version: 3,
				screenshots: [screenshot],
			}),
			"actions.json": JSON.stringify({
				version: 1,
				actions: [second, first],
			}),
		});

		expect(await loadScreenshotsIndex(zip)).toEqual({
			screenshotMetas: [screenshot],
			actions: [{ ...first, failed: false }, second],
		});
	});

	it("returns no actions when actions.json is corrupt or a different version", async () => {
		const corrupt = await zipOf({
			"manifest.json": JSON.stringify({
				version: 3,
				screenshots: [screenshot],
			}),
			"actions.json": "{not json",
		});
		expect((await loadScreenshotsIndex(corrupt)).actions).toEqual([]);
		expect(parseActionsJson({ version: 2, actions: [] })).toEqual([]);
	});

	it("drops malformed action entries while keeping valid ones", () => {
		const valid = {
			pageId: "page@abc",
			start: 100,
			end: 120,
			method: "fill",
			box: { x: 1, y: 2, width: 100, height: 20 },
		};
		expect(
			parseActionsJson({
				version: 1,
				actions: [
					{ pageId: "page@abc", start: 100, end: 120, method: "press" },
					{
						pageId: "page@abc",
						start: 200,
						end: 100,
						method: "click",
						point: { x: 1, y: 2 },
					},
					{
						pageId: "page@abc",
						start: 100,
						end: 120,
						method: "fill",
						box: { x: 1, y: 2, width: -5, height: 20 },
					},
					valid,
				],
			}),
		).toEqual([{ ...valid, failed: false }]);
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
