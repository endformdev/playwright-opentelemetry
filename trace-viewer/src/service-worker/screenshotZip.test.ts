import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import {
	extractScreenshots,
	loadScreenshotsIndex,
	parseActionsJson,
} from "./screenshotZip";

async function loadScreenshotMetas(zip: Blob) {
	return (await loadScreenshotsIndex(zip)).screenshotMetas;
}

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

describe("reading a frame's viewport", () => {
	it("keeps the viewport size a frame was taken at", async () => {
		const sized = { ...screenshot, viewportWidth: 1280, viewportHeight: 720 };
		const zip = await zipWithManifest({ version: 3, screenshots: [sized] });

		expect(await loadScreenshotMetas(zip)).toEqual([sized]);
	});

	it.each([
		["only a width", { viewportWidth: 1280 }],
		["no area", { viewportWidth: 0, viewportHeight: 720 }],
		["text", { viewportWidth: "1280", viewportHeight: "720" }],
	])("leaves out a viewport with %s", async (_, viewport) => {
		const zip = await zipWithManifest({
			version: 3,
			screenshots: [{ ...screenshot, ...viewport }],
		});

		expect(await loadScreenshotMetas(zip)).toEqual([screenshot]);
	});
});

describe("reading actions", () => {
	const click = {
		pageId: "page-0",
		time: 1000,
		frames: { from: 980, until: 1500 },
		method: "click",
		point: { x: 50, y: 60 },
		box: { x: 10, y: 20, width: 100, height: 80 },
	};
	const fill = {
		pageId: "page-0",
		time: 800,
		frames: { from: 820, until: 950 },
		method: "fill",
		box: { x: 1, y: 2, width: 3, height: 4 },
		failed: true,
	};
	const drag = {
		pageId: "page-1",
		time: 1200,
		frames: { from: 1250, until: 1300 },
		method: "dragAndDrop",
		point: { x: 500, y: 400 },
		dragFrom: { x: 50, y: 60 },
	};
	const manifest = JSON.stringify({ version: 3, screenshots: [screenshot] });

	it("reads actions.json beside the manifest, in time order", async () => {
		const zip = await zipOf({
			"manifest.json": manifest,
			"actions.json": JSON.stringify({
				version: 1,
				actions: [click, drag, fill],
			}),
		});

		expect(await loadScreenshotsIndex(zip)).toEqual({
			screenshotMetas: [screenshot],
			actions: [fill, { ...click, failed: false }, { ...drag, failed: false }],
		});
	});

	it("has no actions without the file", async () => {
		const zip = await zipOf({ "manifest.json": manifest });

		expect((await loadScreenshotsIndex(zip)).actions).toEqual([]);
	});

	it.each([
		["text that isn't JSON", "{ not json"],
		[
			"a version it doesn't know",
			JSON.stringify({ version: 2, actions: [click] }),
		],
		["no list of actions", JSON.stringify({ version: 1 })],
	])("has no actions, and still the screenshots, with %s", async (_, file) => {
		const zip = await zipOf({
			"manifest.json": manifest,
			"actions.json": file,
		});

		expect(await loadScreenshotsIndex(zip)).toEqual({
			screenshotMetas: [screenshot],
			actions: [],
		});
	});

	it("leaves out the actions it can't draw and keeps the rest", () => {
		const actions = parseActionsJson({
			version: 1,
			actions: [
				click,
				{ ...click, pageId: undefined },
				{ ...click, time: "soon" },
				{ ...click, frames: undefined },
				{ ...click, frames: { from: 1500, until: 980 } },
				{ ...click, point: undefined, box: undefined },
				{ ...click, point: undefined, box: { ...click.box, width: -3 } },
				null,
			],
		});

		expect(actions).toEqual([{ ...click, failed: false }]);
	});

	it("drops fields it doesn't know", () => {
		const [action] = parseActionsJson({
			version: 1,
			actions: [{ ...click, value: "hunter2", steadyUntil: 1500 }],
		});

		expect(action).toEqual({ ...click, failed: false });
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
