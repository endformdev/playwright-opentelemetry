import { BlobReader, BlobWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import {
	type ActionsFile,
	createScreenshotsZip,
	parseActionsFile,
	readScreenshotsZip,
	type ScreenshotResource,
} from "../src/shared/screenshots-zip";

const FRAME: ScreenshotResource = {
	pageId: "page-0",
	timestamp: 1000,
	file: "page-0-1000.jpeg",
	contentType: "image/jpeg",
	viewportWidth: 1280,
	viewportHeight: 720,
	blob: new Blob(["frame"]),
};

const ACTIONS: ActionsFile = {
	version: 1,
	actions: [
		{
			pageId: "page-0",
			end: 1020,
			method: "click",
			inputs: [
				{
					time: 1000,
					point: { x: 50, y: 60 },
					box: { x: 10, y: 20, width: 100, height: 80 },
				},
			],
			steadySince: 980,
			steadyUntil: 1500,
		},
		{
			pageId: "page-0",
			end: 2100,
			failed: true,
			method: "fill",
			inputs: [
				{ time: 2000, box: { x: 1, y: 2, width: 3, height: 4 } },
				{ time: 2050, box: { x: 1, y: 2, width: 3, height: 4 } },
			],
			steadyFrom: 2100,
			steadyUntil: 2300,
		},
	],
};

describe("actions.json in a screenshots ZIP", () => {
	it("is written beside the manifest and read back", async () => {
		const zip = await createScreenshotsZip([FRAME], ACTIONS);

		expect(await entryNames(zip)).toEqual([
			"manifest.json",
			"screenshots/page-0-1000.jpeg",
			"actions.json",
		]);
		const contents = await readScreenshotsZip(zip);
		expect(contents.actions).toEqual(ACTIONS);
		expect(contents.screenshots).toEqual([
			expect.objectContaining({ pageId: "page-0", timestamp: 1000 }),
		]);
	});

	it("leaves the manifest at the version every viewer reads", async () => {
		const zip = await createScreenshotsZip([FRAME], ACTIONS);

		expect(JSON.parse(await entryText(zip, "manifest.json")).version).toBe(3);
	});

	it("is left out when no actions were recorded, and read as none", async () => {
		const zip = await createScreenshotsZip([FRAME]);

		expect(await entryNames(zip)).not.toContain("actions.json");
		expect((await readScreenshotsZip(zip)).actions).toBeUndefined();
	});

	it("keeps an empty list apart from no file", async () => {
		const zip = await createScreenshotsZip([FRAME], {
			version: 1,
			actions: [],
		});

		expect((await readScreenshotsZip(zip)).actions).toEqual({
			version: 1,
			actions: [],
		});
	});

	it("doesn't cost the screenshots when it can't be read", async () => {
		const zip = await zipWith(await createScreenshotsZip([FRAME]), {
			"actions.json": "{ not json",
		});

		const contents = await readScreenshotsZip(zip);
		expect(contents.actions).toBeUndefined();
		expect(contents.screenshots).toHaveLength(1);
	});
});

describe("parseActionsFile", () => {
	it("reads the file it wrote", () => {
		expect(parseActionsFile(JSON.parse(JSON.stringify(ACTIONS)))).toEqual(
			ACTIONS,
		);
	});

	it.each([
		["another version", { version: 2, actions: [] }],
		["no actions list", { version: 1 }],
		["not an object", "actions"],
		["null", null],
	])("reads nothing from %s", (_, value) => {
		expect(parseActionsFile(value)).toBeUndefined();
	});

	it("leaves out the actions it can't draw and keeps the rest", () => {
		const [click] = ACTIONS.actions;
		const file = parseActionsFile({
			version: 1,
			actions: [
				click,
				{ ...click, pageId: 7 },
				{ ...click, inputs: [] },
				{ ...click, inputs: [{ time: 1000 }] },
				{ ...click, inputs: [{ time: "soon", point: { x: 1, y: 2 } }] },
				{ ...click, end: Number.NaN },
				"click",
			],
		});

		expect(file?.actions).toEqual([click]);
	});

	it("drops fields it doesn't know, such as an input's value", () => {
		const [click] = ACTIONS.actions;
		const file = parseActionsFile({
			version: 1,
			actions: [
				{
					...click,
					value: "hunter2",
					inputs: [{ ...click.inputs[0], value: "hunter2" }],
				},
			],
		});

		expect(JSON.stringify(file)).not.toContain("hunter2");
		expect(file?.actions).toEqual([click]);
	});
});

async function entryNames(zip: Blob): Promise<string[]> {
	const reader = new ZipReader(new BlobReader(zip));
	try {
		return (await reader.getEntries()).map((entry) => entry.filename);
	} finally {
		await reader.close();
	}
}

async function entryText(zip: Blob, name: string): Promise<string> {
	const reader = new ZipReader(new BlobReader(zip));
	try {
		const entry = (await reader.getEntries()).find(
			(entry) => entry.filename === name,
		);
		if (!entry || entry.directory) {
			throw new Error(`No ${name} in the ZIP`);
		}
		return await (await entry.getData(new BlobWriter())).text();
	} finally {
		await reader.close();
	}
}

/** A copy of a ZIP with more files in it. */
async function zipWith(
	zip: Blob,
	files: Record<string, string>,
): Promise<Blob> {
	const reader = new ZipReader(new BlobReader(zip));
	const writer = new ZipWriter(new BlobWriter("application/zip"));
	try {
		for (const entry of await reader.getEntries()) {
			if (!entry.directory) {
				await writer.add(
					entry.filename,
					(await entry.getData(new BlobWriter())).stream(),
				);
			}
		}
		for (const [name, text] of Object.entries(files)) {
			await writer.add(name, new Blob([text]).stream());
		}
		return await writer.close();
	} finally {
		await reader.close();
	}
}
