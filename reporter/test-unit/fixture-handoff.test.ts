import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	FIXTURE_SPANS_HANDOFF_FILE,
	fixtureHandoffDir,
	fixtureHandoffRoot,
	SCREENSHOTS_HANDOFF_FILE,
	TRACE_CONTEXT_HANDOFF_FILE,
} from "../src/shared/fixture-handoff";
import { generateSpanId, generateTraceId } from "../src/shared/otel";
import {
	createScreenshotsZip,
	readScreenshotsZip,
} from "../src/shared/screenshots-zip";
import {
	retainedTraceAttachment,
	runReporterTest,
	temporaryOutputDir,
} from "./reporter-harness";

vi.mock("../src/reporter/sender", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/reporter/sender")>()),
	sendSpans: vi.fn(),
}));

const mockFetch = vi.fn();
const TEST_ID = "file-0-test-0";

describe("fixture handoff files", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = mockFetch;
		mockFetch.mockResolvedValue({ ok: true, status: 200 });
	});

	it("reads the trace context and screenshots the fixture left, then deletes them", async () => {
		const outputDir = temporaryOutputDir();
		const traceContext = await leaveTraceContext(outputDir);
		const zip = await createScreenshotsZip([
			{
				pageId: "page-0",
				timestamp: 1000,
				file: "page-0-1000.jpeg",
				contentType: "image/jpeg",
				blob: new Blob(["frame"]),
			},
		]);
		await leaveFile(
			outputDir,
			SCREENSHOTS_HANDOFF_FILE,
			new Uint8Array(await zip.arrayBuffer()),
		);

		const { testResult } = await runReporterTest({
			config: { outputDir },
			playwrightOpentelemetry: {
				playwrightTraceApiEndpoint: { url: "https://traces.example.com" },
			},
			test: { id: TEST_ID, title: "handoff test" },
			result: { attachments: [retainedTraceAttachment()] },
			includeTraceContextAttachment: false,
		});

		expect(testResult.annotations).toContainEqual({
			type: "playwrightOpentelemetryTraceId",
			description: traceContext.traceId,
		});
		const [, upload] = mockFetch.mock.calls.find(([url]) =>
			String(url).endsWith("/screenshots.zip"),
		)!;
		expect(upload.headers["x-trace-id"]).toBe(traceContext.traceId);
		expect((await readScreenshotsZip(upload.body)).screenshots).toEqual([
			expect.objectContaining({ pageId: "page-0", timestamp: 1000 }),
		]);
		expect(existsSync(fixtureHandoffRoot(outputDir))).toBe(false);
	});

	it("puts the fixture spans it left in the local trace ZIP", async () => {
		const outputDir = temporaryOutputDir();
		const traceContext = await leaveTraceContext(outputDir);
		await leaveFile(
			outputDir,
			FIXTURE_SPANS_HANDOFF_FILE,
			JSON.stringify({
				spans: [
					{
						traceId: traceContext.traceId,
						spanId: generateSpanId(),
						parentSpanId: traceContext.rootSpanId,
						name: "browser.page",
						startTime: "2025-11-06T10:00:00.000Z",
						endTime: "2025-11-06T10:00:01.000Z",
						attributes: {},
						events: [],
						serviceName: "playwright-browser",
					},
				],
			}),
		);

		await runReporterTest({
			config: { outputDir },
			playwrightOpentelemetry: { storeTraceZip: true },
			test: {
				id: TEST_ID,
				title: "handoff test",
				location: { file: "/tests/handoff.spec.ts", line: 3 },
			},
			result: { attachments: [retainedTraceAttachment()] },
			includeTraceContextAttachment: false,
		});

		const traceZip = path.join(
			outputDir,
			`handoff.spec.ts:3-${TEST_ID}-pw-otel.zip`,
		);
		expect(await zipText(traceZip)).toContain('"name": "browser.page"');
		expect(existsSync(fixtureHandoffRoot(outputDir))).toBe(false);
	});

	it("carries the actions the fixture recorded into the upload and the local trace ZIP", async () => {
		const outputDir = temporaryOutputDir();
		await leaveTraceContext(outputDir);
		const actions = {
			version: 1 as const,
			actions: [
				{
					pageId: "page-0",
					end: 1010,
					method: "click",
					inputs: [
						{
							time: 1000,
							point: { x: 5, y: 6 },
							box: { x: 1, y: 2, width: 30, height: 40 },
						},
					],
					steadyUntil: 1400,
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
					blob: new Blob(["frame"]),
				},
			],
			actions,
		);
		await leaveFile(
			outputDir,
			SCREENSHOTS_HANDOFF_FILE,
			new Uint8Array(await zip.arrayBuffer()),
		);

		await runReporterTest({
			config: { outputDir },
			playwrightOpentelemetry: {
				storeTraceZip: true,
				playwrightTraceApiEndpoint: { url: "https://traces.example.com" },
			},
			test: {
				id: TEST_ID,
				title: "handoff test",
				location: { file: "/tests/handoff.spec.ts", line: 3 },
			},
			result: { attachments: [retainedTraceAttachment()] },
			includeTraceContextAttachment: false,
		});

		const [, upload] = mockFetch.mock.calls.find(([url]) =>
			String(url).endsWith("/screenshots.zip"),
		)!;
		expect((await readScreenshotsZip(upload.body)).actions).toEqual(actions);
		const traceZip = new Blob([
			await fs.readFile(
				path.join(outputDir, `handoff.spec.ts:3-${TEST_ID}-pw-otel.zip`),
			),
		]);
		expect((await readScreenshotsZip(traceZip)).actions).toEqual(actions);
	});

	it("deletes what the fixture left for a test it doesn't report", async () => {
		const outputDir = temporaryOutputDir();
		await leaveTraceContext(outputDir);

		await runReporterTest({
			config: { outputDir },
			playwrightOpentelemetry: {
				trace: "retain-on-failure",
				playwrightTraceApiEndpoint: { url: "https://traces.example.com" },
			},
			test: { id: TEST_ID, title: "handoff test" },
			result: { status: "passed", attachments: [] },
			includeTraceContextAttachment: false,
		});

		expect(mockFetch).not.toHaveBeenCalled();
		expect(existsSync(fixtureHandoffRoot(outputDir))).toBe(false);
	});

	it("leaves other test attempts' files alone", async () => {
		const outputDir = temporaryOutputDir();
		await leaveTraceContext(outputDir);
		const nextRetryDir = fixtureHandoffDir(outputDir, TEST_ID, 1);
		await fs.mkdir(nextRetryDir, { recursive: true });
		await fs.writeFile(path.join(nextRetryDir, TRACE_CONTEXT_HANDOFF_FILE), "");

		await runReporterTest({
			config: { outputDir },
			playwrightOpentelemetry: {
				playwrightTraceApiEndpoint: { url: "https://traces.example.com" },
			},
			test: { id: TEST_ID, title: "handoff test" },
			includeTraceContextAttachment: false,
		});

		expect(existsSync(fixtureHandoffDir(outputDir, TEST_ID, 0))).toBe(false);
		expect(existsSync(nextRetryDir)).toBe(true);
	});
});

async function leaveTraceContext(outputDir: string) {
	const traceContext = {
		traceId: generateTraceId(),
		rootSpanId: generateSpanId(),
	};
	await leaveFile(
		outputDir,
		TRACE_CONTEXT_HANDOFF_FILE,
		JSON.stringify(traceContext),
	);
	return traceContext;
}

async function leaveFile(
	outputDir: string,
	fileName: string,
	data: string | Uint8Array,
) {
	const dir = fixtureHandoffDir(outputDir, TEST_ID, 0);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(path.join(dir, fileName), data);
}

async function zipText(zipPath: string): Promise<string> {
	const reader = new ZipReader(
		new BlobReader(new Blob([await fs.readFile(zipPath)])),
	);
	const texts: string[] = [];
	for (const entry of await reader.getEntries()) {
		if (!entry.directory && entry.filename.endsWith(".json")) {
			texts.push(await entry.getData(new TextWriter()));
		}
	}
	await reader.close();
	return texts.join("\n");
}
