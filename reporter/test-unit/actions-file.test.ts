import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import {
	type ActionsFile,
	createScreenshotsZip,
	parseActionsFile,
	readScreenshotsZip,
} from "../src/shared/screenshots-zip";

describe("actions.json in screenshots.zip", () => {
	it("round-trips actions through createScreenshotsZip and readScreenshotsZip", async () => {
		const actions: ActionsFile = {
			version: 1,
			actions: [
				{
					pageId: "page-0",
					start: 1000,
					end: 1040,
					method: "click",
					point: { x: 100, y: 50 },
					box: { x: 40, y: 30, width: 120, height: 40 },
				},
				{
					pageId: "page-0",
					start: 1100,
					end: 1200,
					method: "dragAndDrop",
					point: { x: 200, y: 120 },
					dragFrom: { x: 20, y: 30 },
					failed: true,
				},
			],
		};

		const zip = await createScreenshotsZip(
			[
				{
					pageId: "page-0",
					timestamp: 1000,
					file: "page-0-1000.jpeg",
					contentType: "image/jpeg",
					blob: new Blob(["jpeg-bytes"]),
					viewportWidth: 1280,
					viewportHeight: 720,
				},
			],
			actions,
		);

		const read = await readScreenshotsZip(zip);
		expect(read.screenshots).toHaveLength(1);
		expect(read.screenshots[0]).toMatchObject({
			pageId: "page-0",
			timestamp: 1000,
			viewportWidth: 1280,
			viewportHeight: 720,
		});
		expect(read.actions).toEqual(actions);
	});

	it("returns undefined actions when actions.json is absent or invalid", async () => {
		const writer = new ZipWriter(new BlobWriter("application/zip"));
		await writer.add(
			"manifest.json",
			new TextReader(JSON.stringify({ version: 3, screenshots: [] })),
		);
		await writer.add("actions.json", new TextReader("{broken json"));
		const zip = await writer.close();

		expect((await readScreenshotsZip(zip)).actions).toBeUndefined();
		expect(parseActionsFile({ version: 2, actions: [] })).toBeUndefined();
		expect(parseActionsFile(null)).toBeUndefined();
	});

	it("filters out malformed action entries when parsing", () => {
		expect(
			parseActionsFile({
				version: 1,
				actions: [
					{
						pageId: "page-0",
						start: 100,
						end: 50,
						method: "click",
						point: { x: 1, y: 2 },
					},
					{
						pageId: "page-0",
						start: 100,
						end: 120,
						method: "press",
					},
					{
						pageId: "page-0",
						start: 100,
						end: 120,
						method: "fill",
						box: { x: 10, y: 20, width: 80, height: 30 },
					},
				],
			}),
		).toEqual({
			version: 1,
			actions: [
				{
					pageId: "page-0",
					start: 100,
					end: 120,
					method: "fill",
					box: { x: 10, y: 20, width: 80, height: 30 },
				},
			],
		});
	});
});
