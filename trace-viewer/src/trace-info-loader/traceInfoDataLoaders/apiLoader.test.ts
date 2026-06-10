import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRemoteApi } from "./apiLoader";
import { loadRrwebZipData } from "../rrwebZip";

vi.mock("../rrwebZip", () => ({
	loadRrwebZipData: vi.fn(),
}));

describe("loading a trace from the remote trace API", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it("loads trace data, derives test header metadata, and loads rrweb ZIP", async () => {
		const traceId = "7709187832dca84f02f413a312421586";
		const rrwebTrace = { recordings: [] };
		vi.mocked(loadRrwebZipData).mockResolvedValueOnce(rrwebTrace);
		const fetchMock = vi.fn(async (url: string) => {
			if (url === `https://traces.example.com/${traceId}/traces`) {
				return jsonResponse(otlpExport(traceId));
			}
			if (url === `https://traces.example.com/${traceId}/rrweb.zip`) {
				return new Response(new Blob(["zip"]), { status: 200 });
			}
			return textResponse("not found", 404);
		});
		vi.stubGlobal("fetch", fetchMock);

		const traceInfo = await loadRemoteApi(
			`https://traces.example.com/${traceId}/`,
		);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			`https://traces.example.com/${traceId}/traces`,
		);
		expect(traceInfo.testInfo).toEqual({
			name: "checkout completes",
			describes: ["Checkout", "Happy path"],
			file: "tests/checkout.spec.ts",
			line: 42,
			status: "passed",
			traceId,
			startTimeUnixNano: "1766927492000000000",
			endTimeUnixNano: "1766927493000000000",
		});
		expect(traceInfo.traceData.resourceSpans).toHaveLength(2);
		expect(traceInfo.rrweb).toBe(rrwebTrace);
		expect(loadRrwebZipData).toHaveBeenCalledTimes(1);
	});

	it("uses an empty rrweb trace when rrweb ZIP is missing", async () => {
		const traceId = "7709187832dca84f02f413a312421586";
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (url.endsWith("/traces")) return jsonResponse(otlpExport(traceId));
				return textResponse("not found", 404);
			}),
		);

		const traceInfo = await loadRemoteApi(
			`https://traces.example.com/${traceId}`,
		);
		expect(traceInfo.rrweb).toEqual({ recordings: [] });
		expect(loadRrwebZipData).not.toHaveBeenCalled();
	});

	it("surfaces a missing trace before trying to load rrweb", async () => {
		const traceId = "7709187832dca84f02f413a312421586";
		const fetchMock = vi.fn(async (url: string) => {
			if (url === `https://traces.example.com/${traceId}/traces`) {
				return textResponse("Trace not found", 404);
			}
			return new Response(null, { status: 404 });
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			loadRemoteApi(`https://traces.example.com/${traceId}`),
		).rejects.toThrow("Failed to fetch trace data");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("fails clearly when the trace API returns data without a Playwright root span", async () => {
		const traceId = "7709187832dca84f02f413a312421586";
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (url.endsWith("/traces")) {
					return jsonResponse(otlpExport(traceId, { includeTestSpan: false }));
				}
				return new Response(null, { status: 404 });
			}),
		);

		await expect(
			loadRemoteApi(`https://traces.example.com/${traceId}`),
		).rejects.toThrow("no playwright.test span found");
	});
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function textResponse(body: string, status: number): Response {
	return new Response(body, { status });
}

function otlpExport(
	traceId: string,
	options: { includeTestSpan?: boolean } = {},
) {
	const includeTestSpan = options.includeTestSpan ?? true;
	return {
		resourceSpans: [
			{
				resource: {
					attributes: [
						{ key: "service.name", value: { stringValue: "playwright-tests" } },
					],
				},
				scopeSpans: [
					{
						scope: { name: "playwright-opentelemetry", version: "0.0.0" },
						spans: [
							...(includeTestSpan ? [testSpan(traceId)] : []),
							span(traceId, "step000000000001", "playwright.test.step", {
								parentSpanId: "testspan0000001",
								attributes: [
									{
										key: "test.step.title",
										value: { stringValue: "click checkout" },
									},
								],
							}),
						],
					},
				],
			},
			{
				resource: {
					attributes: [
						{ key: "service.name", value: { stringValue: "backend-api" } },
					],
				},
				scopeSpans: [
					{
						scope: { name: "http", version: "1.0.0" },
						spans: [span(traceId, "backend00000001", "HTTP GET /checkout")],
					},
				],
			},
		],
	};
}

function testSpan(traceId: string) {
	return span(traceId, "testspan0000001", "playwright.test", {
		attributes: [
			{ key: "test.case.title", value: { stringValue: "checkout completes" } },
			{
				key: "playwright.test.describes",
				value: {
					arrayValue: {
						values: [
							{ stringValue: "Checkout" },
							{ stringValue: "Happy path" },
						],
					},
				},
			},
			{ key: "playwright.test.status", value: { stringValue: "passed" } },
			{
				key: "code.file.path",
				value: { stringValue: "tests/checkout.spec.ts" },
			},
			{ key: "code.line.number", value: { intValue: 42 } },
		],
	});
}

function span(
	traceId: string,
	spanId: string,
	name: string,
	options: { parentSpanId?: string; attributes?: unknown[] } = {},
) {
	return {
		traceId,
		spanId,
		parentSpanId: options.parentSpanId,
		name,
		kind: 1,
		startTimeUnixNano: "1766927492000000000",
		endTimeUnixNano: "1766927493000000000",
		attributes: options.attributes ?? [],
		droppedAttributesCount: 0,
		events: [],
		droppedEventsCount: 0,
		status: { code: 1 },
		links: [],
		droppedLinksCount: 0,
	};
}
