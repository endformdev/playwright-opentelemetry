import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLocalZip, loadRemoteZip } from "./zipLoader";

const serviceWorker = vi.hoisted(() => ({
	registerServiceWorker: vi.fn(async () => ({}) as ServiceWorkerRegistration),
	loadTraceInServiceWorker: vi.fn(),
	loadScreenshotsZipInServiceWorker: vi.fn(),
	unloadTraceFromServiceWorker: vi.fn(async () => undefined),
	getTraceViewerApiUrl: vi.fn(
		(traceId: string) => `/playwright-otel-trace-viewer/v1/${traceId}`,
	),
}));

vi.mock("../../service-worker/register", () => serviceWorker);

describe("loading ZIP traces", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it("loads a local ZIP through the service worker and returns TraceInfo directly", async () => {
		const traceId = "7709187832dca84f02f413a312421586";
		const file = new File(["zip bytes"], "trace.zip", {
			type: "application/zip",
		});
		serviceWorker.loadTraceInServiceWorker.mockResolvedValueOnce({
			traceId,
			traceData: otlpExport(traceId),
			screenshotMetas: [
				{ timestamp: 1766927492300, file: "page@abc-1766927492300.jpeg" },
			],
		});

		const traceInfo = await loadLocalZip(file);

		expect(serviceWorker.registerServiceWorker).toHaveBeenCalledTimes(1);
		expect(serviceWorker.unloadTraceFromServiceWorker).toHaveBeenCalledTimes(1);
		expect(serviceWorker.loadTraceInServiceWorker).toHaveBeenCalledWith({
			zip: file,
		});
		expect(traceInfo.testInfo.name).toBe("checkout completes");
		expect(traceInfo.traceData.resourceSpans).toHaveLength(1);
		expect(traceInfo.screenshots()).toEqual([
			{
				timestamp: 1766927492300,
				url: `/playwright-otel-trace-viewer/v1/${traceId}/screenshots/page@abc-1766927492300.jpeg`,
			},
		]);
	});

	it("downloads a remote ZIP and passes the blob to the service worker", async () => {
		const traceId = "7709187832dca84f02f413a312421586";
		const zipBlob = new Blob(["zip bytes"], { type: "application/zip" });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(zipBlob)),
		);
		serviceWorker.loadTraceInServiceWorker.mockResolvedValueOnce({
			traceId,
			traceData: otlpExport(traceId),
			screenshotMetas: [],
		});

		const traceInfo = await loadRemoteZip("https://example.com/trace.zip");

		expect(fetch).toHaveBeenCalledWith("https://example.com/trace.zip");
		expect(serviceWorker.loadTraceInServiceWorker).toHaveBeenCalledWith({
			zip: expect.any(Blob),
		});
		expect(traceInfo.traceData.resourceSpans).toHaveLength(1);
	});
});

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
