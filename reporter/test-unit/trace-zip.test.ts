import type { TestCase } from "@playwright/test/reporter";
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";
import { describe, expect, it, vi } from "vitest";
import { RRWEB_RECORDINGS_ATTACHMENT_NAME } from "../src/fixture/trace-context";
import { createTraceZipBlob } from "../src/reporter/trace-zip-builder";
import type { Span } from "../src/shared/otel";
import {
	buildTestCase,
	DEFAULT_PLAYWRIGHT_OPENTELEMETRY_CONFIG,
	runReporterTest,
} from "./reporter-harness";

vi.mock("../src/reporter/sender", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../src/reporter/sender")>();
	return {
		...actual,
		sendSpans: vi.fn(),
	};
});

describe("trace ZIP rrweb artifacts", () => {
	it("includes rrweb manifest and recording segments", async () => {
		const zip = await createTraceZipBlob({
			test: testCase(),
			spans: [testSpan()],
			fixtureSpans: [],
			serviceName: "playwright-tests",
			playwrightVersion: "1.60.0",
			rrweb: rrwebArtifact(),
		});

		const entries = await readZipTextEntries(zip);
		const manifest = JSON.parse(entries.get("rrweb/manifest.json") ?? "{}");
		const events = JSON.parse(
			entries.get("rrweb/recordings/page-1/00000.json") ?? "[]",
		);

		expect(entries.has("traces/playwright-opentelemetry.json")).toBe(true);
		expect(manifest.recordings[0]).toMatchObject({
			id: "page-1",
			pageId: "page-1",
			startTime: 1766927492000,
			endTime: 1766927492100,
			eventCount: 2,
		});
		expect(manifest.recordings[0].segments[0]).toMatchObject({
			file: "rrweb/recordings/page-1/00000.json",
			hasFullSnapshot: true,
		});
		expect(events).toHaveLength(2);
	});

	it("writes a valid OTLP-only ZIP when rrweb is absent", async () => {
		const zip = await createTraceZipBlob({
			test: testCase(),
			spans: [testSpan()],
			fixtureSpans: [],
			serviceName: "playwright-tests",
			playwrightVersion: "1.60.0",
			rrweb: null,
		});

		const entries = await readZipTextEntries(zip);
		expect(entries.has("traces/playwright-opentelemetry.json")).toBe(true);
		expect(entries.has("rrweb/manifest.json")).toBe(false);
	});

	it("uploads rrweb.zip to the Trace API endpoint", async () => {
		const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await runReporterTest({
			playwrightOpentelemetry: {
				...DEFAULT_PLAYWRIGHT_OPENTELEMETRY_CONFIG,
				playwrightTraceApiEndpoint: "https://traces.example.com",
			},
			test: { title: "uploads rrweb" },
			result: {
				attachments: [
					{
						name: RRWEB_RECORDINGS_ATTACHMENT_NAME,
						contentType: "application/json",
						body: Buffer.from(JSON.stringify(rrwebArtifact())),
					},
				],
			},
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"https://traces.example.com/playwright-otel-reporter/v1/rrweb.zip",
			expect.objectContaining({
				method: "PUT",
				headers: expect.objectContaining({
					"content-type": "application/zip",
					"x-trace-id": expect.any(String),
				}),
				body: expect.any(Blob),
			}),
		);
	});

	it("fails clearly for malformed rrweb attachments", async () => {
		await expect(
			runReporterTest({
				playwrightOpentelemetry: {
					...DEFAULT_PLAYWRIGHT_OPENTELEMETRY_CONFIG,
					storeTraceZip: true,
				},
				test: { title: "bad rrweb" },
				result: {
					attachments: [
						{
							name: RRWEB_RECORDINGS_ATTACHMENT_NAME,
							contentType: "application/json",
							body: Buffer.from(
								JSON.stringify({ version: 1, recordings: [{}] }),
							),
						},
					],
				},
			}),
		).rejects.toThrow(RRWEB_RECORDINGS_ATTACHMENT_NAME);
	});
});

async function readZipTextEntries(zip: Blob): Promise<Map<string, string>> {
	const zipReader = new ZipReader(new BlobReader(zip));
	try {
		const entries = await zipReader.getEntries();
		const result = new Map<string, string>();
		for (const entry of entries) {
			if (!entry.directory && entry.filename.endsWith(".json")) {
				result.set(entry.filename, await entry.getData(new TextWriter()));
			}
		}
		return result;
	} finally {
		await zipReader.close();
	}
}

function testCase(): TestCase {
	return buildTestCase(
		{ id: "test-id", title: "checkout completes" },
		"/tmp/playwright-opentelemetry-test",
		DEFAULT_PLAYWRIGHT_OPENTELEMETRY_CONFIG,
	) as TestCase;
}

function testSpan(): Span {
	return {
		traceId: "7709187832dca84f02f413a312421586",
		spanId: "testspan0000001",
		name: "playwright.test",
		startTime: new Date("2025-11-06T10:00:00.000Z"),
		endTime: new Date("2025-11-06T10:00:01.000Z"),
		attributes: { "test.case.title": "checkout completes" },
	};
}

function rrwebArtifact() {
	return {
		version: 1 as const,
		recordings: [
			{
				id: "page-1",
				pageId: "page-1",
				documentId: "document-1",
				initialUrl: "https://example.test/checkout",
				events: [
					{
						type: 4,
						timestamp: 1766927492000,
						data: { href: "https://example.test" },
					},
					{ type: 2, timestamp: 1766927492100, data: { node: { id: 1 } } },
				],
			},
		],
		warnings: [],
	};
}
