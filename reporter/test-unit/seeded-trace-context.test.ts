import fs from "node:fs/promises";
import path from "node:path";
import type { TestInfo } from "@playwright/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestTraceContext,
	TRACE_CONTEXT_ATTACHMENT_NAME,
} from "../src/fixture/trace-context";
import { TEST_SPAN_NAME } from "../src/reporter/reporter-attributes";
import { sendSpans } from "../src/reporter/sender";
import {
	fixtureHandoffDir,
	TRACE_CONTEXT_HANDOFF_FILE,
} from "../src/shared/fixture-handoff";
import { runReporterTest, temporaryOutputDir } from "./reporter-harness";

vi.mock("../src/reporter/sender", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/reporter/sender")>()),
	sendSpans: vi.fn(),
}));

const TEST_ID = "file-0-test-0";
const SEEDED = {
	traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
	rootSpanId: "00f067aa0ba902b7",
};

describe("trace context seeded by a host", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses the seeded IDs in the fixture, the annotation and the test span", async () => {
		const outputDir = temporaryOutputDir();
		await seed(outputDir, JSON.stringify(SEEDED));

		const traceContext = await createTestTraceContext(testInfo(outputDir), {
			attachFixtureData: false,
		});

		expect(traceContext).toMatchObject(SEEDED);
		expect(await reportedIds(outputDir)).toEqual(SEEDED);
	});

	it("attaches the seeded IDs with attachFixtureData", async () => {
		const outputDir = temporaryOutputDir();
		await seed(outputDir, JSON.stringify(SEEDED));
		const info = testInfo(outputDir);

		const traceContext = await createTestTraceContext(info, {
			attachFixtureData: true,
		});

		expect(traceContext).toMatchObject(SEEDED);
		expect(info.attach).toHaveBeenCalledWith(TRACE_CONTEXT_ATTACHMENT_NAME, {
			body: JSON.stringify(SEEDED),
			contentType: "application/json",
		});
	});

	it("uses the seeded IDs for an attempt that ended before the fixture ran", async () => {
		const outputDir = temporaryOutputDir();
		await seed(outputDir, JSON.stringify(SEEDED));

		expect(await reportedIds(outputDir, { status: "failed" })).toEqual(SEEDED);
	});

	it("warns about an invalid seeded file and replaces it with new IDs", async () => {
		const outputDir = temporaryOutputDir();
		await seed(outputDir, '{"traceId": "4bf92f35');
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const traceContext = await createTestTraceContext(testInfo(outputDir), {
			attachFixtureData: false,
		});

		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(
				`Ignoring invalid ${TRACE_CONTEXT_HANDOFF_FILE} for test ${TEST_ID}`,
			),
		);
		expect(traceContext.traceId).toMatch(/^[0-9a-f]{32}$/);
		expect(traceContext.rootSpanId).toMatch(/^[0-9a-f]{16}$/);
		expect(await reportedIds(outputDir)).toEqual({
			traceId: traceContext.traceId,
			rootSpanId: traceContext.rootSpanId,
		});
	});

	it("creates new IDs and hands them to the reporter without a seeded file", async () => {
		const outputDir = temporaryOutputDir();

		const traceContext = await createTestTraceContext(testInfo(outputDir), {
			attachFixtureData: false,
		});

		expect(traceContext.traceId).toMatch(/^[0-9a-f]{32}$/);
		expect(await reportedIds(outputDir)).toEqual({
			traceId: traceContext.traceId,
			rootSpanId: traceContext.rootSpanId,
		});
	});
});

async function seed(outputDir: string, body: string) {
	const dir = fixtureHandoffDir(outputDir, TEST_ID, 0);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(path.join(dir, TRACE_CONTEXT_HANDOFF_FILE), body);
}

function testInfo(outputDir: string) {
	return {
		attach: vi.fn(),
		retry: 0,
		testId: TEST_ID,
		project: { outputDir },
	} as unknown as TestInfo & { attach: ReturnType<typeof vi.fn> };
}

/** Runs the reporter for the attempt and returns the IDs it reported. */
async function reportedIds(
	outputDir: string,
	result: { status?: "passed" | "failed" } = {},
) {
	const { testResult } = await runReporterTest({
		config: { outputDir },
		test: { id: TEST_ID, title: "seeded test" },
		result,
		includeTraceContextAttachment: false,
	});
	const annotation = testResult.annotations.find(
		(annotation) => annotation.type === "playwrightOpentelemetryTraceId",
	);
	const [spans] = vi.mocked(sendSpans).mock.calls[0];
	const testSpan = spans.find((span) => span.name === TEST_SPAN_NAME)!;
	expect(testSpan.traceId).toBe(annotation?.description);
	return { traceId: testSpan.traceId, rootSpanId: testSpan.spanId };
}
