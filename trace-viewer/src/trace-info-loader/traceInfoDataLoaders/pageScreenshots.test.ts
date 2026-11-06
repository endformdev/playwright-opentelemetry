import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	loadScreenshotsInPage,
	unloadPageScreenshots,
} from "./pageScreenshots";

const ZIP_URL = "https://traces.example.com/trace/screenshots.zip";

async function screenshotsZip(files: string[]): Promise<Blob> {
	const writer = new ZipWriter(new BlobWriter("application/zip"));
	await writer.add(
		"manifest.json",
		new TextReader(
			JSON.stringify({
				version: 3,
				screenshots: files.map((file, index) => ({
					timestamp: index,
					file,
					path: `screenshots/${file}`,
					contentType: "image/jpeg",
					pageId: "page@abc",
				})),
			}),
		),
	);
	for (const file of files) {
		await writer.add(`screenshots/${file}`, new TextReader(`image ${file}`));
	}
	return writer.close();
}

function stubZipResponse(zip: Blob): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(zip)),
	);
}

describe("loading screenshots in the page", () => {
	let nextUrl = 0;
	const blobsByUrl = new Map<string, Blob>();
	const revoked: string[] = [];

	beforeEach(() => {
		vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
			const url = `blob:null/${nextUrl++}`;
			blobsByUrl.set(url, blob as Blob);
			return url;
		});
		vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
			revoked.push(url);
		});
	});

	afterEach(() => {
		unloadPageScreenshots();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		blobsByUrl.clear();
		revoked.length = 0;
	});

	it("unpacks the ZIP into blob URLs with their manifest details", async () => {
		const zip = await screenshotsZip(["a.jpeg", "b.jpeg"]);
		stubZipResponse(zip);

		const screenshots = await loadScreenshotsInPage(ZIP_URL);

		expect(fetch).toHaveBeenCalledWith(ZIP_URL);
		expect(screenshots).toEqual([
			{
				timestamp: 0,
				url: expect.stringMatching(/^blob:/),
				pageId: "page@abc",
			},
			{
				timestamp: 1,
				url: expect.stringMatching(/^blob:/),
				pageId: "page@abc",
			},
		]);
		const blob = blobsByUrl.get(screenshots[1].url);
		expect(blob?.type).toBe("image/jpeg");
		expect(await blob?.text()).toBe("image b.jpeg");
	});

	it("has no screenshots when the ZIP doesn't exist", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 404 })),
		);

		expect(await loadScreenshotsInPage(ZIP_URL)).toEqual([]);
	});

	it("fails on other errors, without the URL and its token", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 500 })),
		);

		const error = await loadScreenshotsInPage(
			`${ZIP_URL}?traceToken=secret`,
		).catch((error: Error) => error);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe(
			"Failed to fetch screenshots ZIP: 500",
		);
	});

	it("revokes the blob URLs on unload", async () => {
		stubZipResponse(await screenshotsZip(["a.jpeg", "b.jpeg"]));
		const screenshots = await loadScreenshotsInPage(ZIP_URL);

		unloadPageScreenshots();

		expect(revoked).toEqual(screenshots.map(({ url }) => url));
	});

	it("revokes the previous trace's URLs only once the next one is ready", async () => {
		stubZipResponse(await screenshotsZip(["a.jpeg"]));
		const [first] = await loadScreenshotsInPage(ZIP_URL);

		stubZipResponse(await screenshotsZip(["b.jpeg"]));
		const loading = loadScreenshotsInPage(ZIP_URL);
		expect(revoked).toEqual([]);
		const [second] = await loading;

		expect(revoked).toEqual([first.url]);
		expect(revoked).not.toContain(second.url);
	});

	it("drops a slower, older load rather than the one that replaced it", async () => {
		const slowZip = await screenshotsZip(["slow.jpeg"]);
		let finishSlowFetch = (_response: Response) => {};
		vi.stubGlobal(
			"fetch",
			vi.fn(
				() =>
					new Promise<Response>((resolve) => {
						finishSlowFetch = resolve;
					}),
			),
		);
		const slow = loadScreenshotsInPage(ZIP_URL);

		stubZipResponse(await screenshotsZip(["latest.jpeg"]));
		const [latest] = await loadScreenshotsInPage(ZIP_URL);
		finishSlowFetch(new Response(slowZip));

		expect(await slow).toEqual([]);
		expect(blobsByUrl.size).toBe(1);
		expect(revoked).not.toContain(latest.url);
	});

	it("creates no URLs for a load the trace was unloaded during", async () => {
		const zip = await screenshotsZip(["a.jpeg"]);
		let finishFetch = (_response: Response) => {};
		vi.stubGlobal(
			"fetch",
			vi.fn(
				() =>
					new Promise<Response>((resolve) => {
						finishFetch = resolve;
					}),
			),
		);
		const loading = loadScreenshotsInPage(ZIP_URL);

		unloadPageScreenshots();
		finishFetch(new Response(zip));

		expect(await loading).toEqual([]);
		expect(blobsByUrl.size).toBe(0);
	});
});
