import { BlobWriter, ZipWriter } from "@zip.js/zip.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLocalZip, loadRemoteZip } from "./zipLoader";

describe("loading ZIP traces", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("loads a local ZIP directly and returns OTLP plus rrweb data", async () => {
		const traceId = "7709187832dca84f02f413a312421586";
		const zip = await createTraceZip(traceId, true);
		const file = new File([zip], "trace.zip", { type: "application/zip" });

		const traceInfo = await loadLocalZip(file);

		expect(traceInfo.testInfo.name).toBe("checkout completes");
		expect(traceInfo.traceData.resourceSpans).toHaveLength(1);
		expect(traceInfo.rrweb.recordings).toHaveLength(1);
		expect(traceInfo.rrweb.recordings[0].events).toHaveLength(2);
	});

	it("loads a remote ZIP directly", async () => {
		const traceId = "7709187832dca84f02f413a312421586";
		const zip = await createTraceZip(traceId, true);
		const fetchMock = vi.fn(async () => new Response(zip, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const traceInfo = await loadRemoteZip("https://example.com/trace.zip");

		expect(fetchMock).toHaveBeenCalledWith("https://example.com/trace.zip");
		expect(traceInfo.traceData.resourceSpans).toHaveLength(1);
		expect(traceInfo.rrweb.recordings[0].id).toBe("page-1");
	});

	it("returns an empty rrweb trace when the ZIP has no rrweb manifest", async () => {
		const traceId = "7709187832dca84f02f413a312421586";
		const zip = await createTraceZip(traceId, false);

		const traceInfo = await loadLocalZip(
			new File([zip], "trace.zip", { type: "application/zip" }),
		);

		expect(traceInfo.rrweb).toEqual({ recordings: [] });
	});
});

async function createTraceZip(
	traceId: string,
	includeRrweb: boolean,
): Promise<Blob> {
	const blobWriter = new BlobWriter("application/zip");
	const zipWriter = new ZipWriter(blobWriter);
	await zipWriter.add(
		"traces/playwright-opentelemetry.json",
		new Blob([JSON.stringify(otlpExport(traceId))]).stream(),
	);

	if (includeRrweb) {
		await zipWriter.add(
			"rrweb/manifest.json",
			new Blob([
				JSON.stringify({
					version: 1,
					recordings: [
						{
							id: "page-1",
							pageId: "page-1",
							startTime: 1766927492000,
							endTime: 1766927492100,
							eventCount: 2,
							segments: [
								{
									file: "rrweb/recordings/page-1/00000.json",
									startTime: 1766927492000,
									endTime: 1766927492100,
									eventCount: 2,
									hasFullSnapshot: true,
								},
							],
						},
					],
				}),
			]).stream(),
		);
		await zipWriter.add(
			"rrweb/recordings/page-1/00000.json",
			new Blob([
				JSON.stringify([
					{
						type: 4,
						timestamp: 1766927492000,
						data: { href: "https://example.test" },
					},
					{ type: 2, timestamp: 1766927492100, data: { node: { id: 1 } } },
				]),
			]).stream(),
		);
	}

	return zipWriter.close();
}

function otlpExport(traceId: string) {
	return {
		resourceSpans: [
			{
				resource: { attributes: [] },
				scopeSpans: [
					{
						scope: { name: "playwright-opentelemetry", version: "0.0.0" },
						spans: [
							{
								traceId,
								spanId: "testspan0000001",
								name: "playwright.test",
								kind: 1,
								startTimeUnixNano: "1766927492000000000",
								endTimeUnixNano: "1766927493000000000",
								attributes: [
									{
										key: "test.case.title",
										value: { stringValue: "checkout completes" },
									},
								],
								droppedAttributesCount: 0,
								events: [],
								droppedEventsCount: 0,
								status: { code: 1 },
								links: [],
								droppedLinksCount: 0,
							},
						],
					},
				],
			},
		],
	};
}
