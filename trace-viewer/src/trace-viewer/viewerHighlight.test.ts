import { describe, expect, it } from "vitest";
import type { Span } from "../trace-data-loader/exportToSpans";
import {
	parseViewerHighlight,
	parseViewerHighlights,
	resolveViewerHighlight,
	resolveViewerHighlights,
	type ViewerHighlight,
} from "./viewerHighlight";

function highlights(query: string) {
	return parseViewerHighlights(new URLSearchParams(query));
}

describe("parseViewerHighlight", () => {
	it("reads every field", () => {
		expect(
			parseViewerHighlight(
				"span:0af7651916cd43dd~time:1731234567890~loc:tests/login.spec.ts:12:5~at:start~label:Fills the form",
			),
		).toEqual({
			spanId: "0af7651916cd43dd",
			startTimeMs: 1731234567890,
			location: { file: "tests/login.spec.ts", line: 12, column: 5 },
			at: "start",
			label: "Fills the form",
		});
	});

	it("reads a location without a column", () => {
		expect(parseViewerHighlight("loc:tests/login.spec.ts:12")).toEqual({
			location: { file: "tests/login.spec.ts", line: 12 },
		});
	});

	it("keeps the separator and colons in a label, which runs to the end", () => {
		expect(
			parseViewerHighlight("span:abc~label:Before ~ after: at:start")?.label,
		).toBe("Before ~ after: at:start");
		expect(
			parseViewerHighlight("span:abc~label:x~at:start")?.at,
		).toBeUndefined();
	});

	it("needs a target", () => {
		expect(parseViewerHighlight("")).toBeNull();
		expect(parseViewerHighlight("label:Only a caption")).toBeNull();
		expect(parseViewerHighlight("at:start~label:No target")).toBeNull();
	});

	it("ignores fields it can't read", () => {
		expect(
			parseViewerHighlight(
				"time:soon~loc:no-line~at:middle~category:changed~nonsense~span:abc",
			),
		).toEqual({ spanId: "abc" });
	});

	it("shortens a long label", () => {
		expect(
			parseViewerHighlight(`span:abc~label:${"x".repeat(300)}`)?.label,
		).toHaveLength(120);
	});
});

describe("parseViewerHighlights", () => {
	it("highlights nothing without parameters", () => {
		expect(highlights("")).toEqual([]);
		expect(highlights("traceSource=x&highlight=label%3ANo%20target")).toEqual(
			[],
		);
	});

	it("keeps the highlights' order", () => {
		const params = new URLSearchParams();
		params.append("highlight", "span:aaaa~label:First");
		params.append("highlight", "time:1731234567890~loc:tests/a.spec.ts:3:7");
		params.append("highlight", "loc:tests/a.spec.ts:9~at:start");
		expect(parseViewerHighlights(params)).toEqual([
			{ spanId: "aaaa", label: "First" },
			{
				startTimeMs: 1731234567890,
				location: { file: "tests/a.spec.ts", line: 3, column: 7 },
			},
			{ location: { file: "tests/a.spec.ts", line: 9 }, at: "start" },
		]);
	});

	it("reads highlights written without percent-encoding", () => {
		expect(
			highlights(
				"highlight=time:1731234567890~loc:tests/a.spec.ts:3~label:Saves%20it",
			),
		).toEqual([
			{
				startTimeMs: 1731234567890,
				location: { file: "tests/a.spec.ts", line: 3 },
				label: "Saves it",
			},
		]);
	});

	it("keeps at most 20 highlights", () => {
		const params = new URLSearchParams();
		for (let i = 0; i < 30; i++) params.append("highlight", `span:${i}`);
		expect(parseViewerHighlights(params)).toHaveLength(20);
	});
});

const TEST_START_MS = 1_731_234_560_000;

function step(
	id: string,
	startOffsetMs: number,
	durationMs: number,
	options: {
		file?: string;
		line?: number;
		column?: number;
		failed?: boolean;
	} = {},
): Span {
	const attributes: Span["attributes"] = {};
	if (options.file !== undefined) attributes["code.file.path"] = options.file;
	if (options.line !== undefined) attributes["code.line.number"] = options.line;
	if (options.column !== undefined) {
		attributes["code.column.number"] = options.column;
	}
	return {
		id,
		parentId: null,
		traceId: "trace",
		name: "playwright.test.step",
		title: id,
		startOffsetMs,
		durationMs,
		kind: "internal",
		attributes,
		status: options.failed ? { code: 2 } : { code: 1 },
		serviceName: "playwright-tests",
	};
}

const FILE = "tests/login.spec.ts";
const steps = [
	step("group", 1000, 900, { file: FILE, line: 10, column: 3 }),
	// Starts as the group does
	step("fill", 1000, 200, { file: FILE, line: 11, column: 5 }),
	step("click", 1200, 300, { file: FILE, line: 12, column: 5 }),
	// A loop: the same line three times, the second failing
	step("check-1", 1500, 100, { file: FILE, line: 20, column: 7 }),
	step("check-2", 1600, 100, { file: FILE, line: 20, column: 7, failed: true }),
	step("check-3", 1700, 100, { file: FILE, line: 20, column: 7 }),
	step("save-1", 1800, 50, { file: FILE, line: 30, column: 5 }),
	step("save-2", 1850, 50, { file: FILE, line: 30, column: 5 }),
	// An older trace: no column
	step("old", 2000, 100, { file: FILE, line: 40 }),
];
const browserSpan: Span = {
	...step("browser", 1250, 20),
	name: "HTTP GET",
	serviceName: "playwright-browser",
};
const spans = {
	spanById: new Map([...steps, browserSpan].map((span) => [span.id, span])),
	steps,
	testStartTimeMs: TEST_START_MS,
};

function resolve(highlight: ViewerHighlight) {
	return resolveViewerHighlight(highlight, spans)?.id ?? null;
}

describe("resolveViewerHighlight", () => {
	it("finds a span by its ID, steps or not", () => {
		expect(resolve({ spanId: "click" })).toBe("click");
		expect(resolve({ spanId: "browser" })).toBe("browser");
	});

	it("falls through to the other targets when the ID is unknown", () => {
		expect(resolve({ spanId: "missing" })).toBeNull();
		expect(
			resolve({ spanId: "missing", startTimeMs: TEST_START_MS + 1200 }),
		).toBe("click");
	});

	it("finds a step by its start time and location", () => {
		expect(
			resolve({
				startTimeMs: TEST_START_MS + 1000,
				location: { file: FILE, line: 11, column: 5 },
			}),
		).toBe("fill");
		expect(
			resolve({
				startTimeMs: TEST_START_MS + 1000,
				location: { file: FILE, line: 10, column: 3 },
			}),
		).toBe("group");
	});

	it("matches a location with another root", () => {
		expect(
			resolve({
				startTimeMs: TEST_START_MS + 1000,
				location: { file: `e2e/${FILE}`, line: 11 },
			}),
		).toBe("fill");
		expect(
			resolve({
				startTimeMs: TEST_START_MS + 1000,
				location: { file: "./login.spec.ts", line: 11 },
			}),
		).toBe("fill");
	});

	it("falls back to the start time when the location doesn't match", () => {
		expect(
			resolve({
				startTimeMs: TEST_START_MS + 1200,
				location: { file: "other.spec.ts", line: 12, column: 5 },
			}),
		).toBe("click");
		// Of steps starting together, the outermost
		expect(
			resolve({
				startTimeMs: TEST_START_MS + 1000,
				location: { file: FILE, line: 99 },
			}),
		).toBe("group");
	});

	it("falls back to the location when no step starts then", () => {
		expect(
			resolve({
				startTimeMs: TEST_START_MS + 1201,
				location: { file: FILE, line: 12, column: 5 },
			}),
		).toBe("click");
	});

	it("finds a step by its start time alone, to the millisecond", () => {
		expect(resolve({ startTimeMs: TEST_START_MS + 1200 })).toBe("click");
		expect(resolve({ startTimeMs: TEST_START_MS + 1000 })).toBe("group");
		expect(resolve({ startTimeMs: TEST_START_MS + 1201 })).toBeNull();
		// Only steps: the browser span starts at 1250
		expect(resolve({ startTimeMs: TEST_START_MS + 1250 })).toBeNull();
	});

	it("finds a step by its location alone", () => {
		expect(resolve({ location: { file: FILE, line: 12, column: 5 } })).toBe(
			"click",
		);
		expect(resolve({ location: { file: FILE, line: 12, column: 9 } })).toBe(
			null,
		);
	});

	it("picks the failed run of a loop, else the last", () => {
		expect(resolve({ location: { file: FILE, line: 20 } })).toBe("check-2");
		expect(resolve({ location: { file: FILE, line: 30, column: 5 } })).toBe(
			"save-2",
		);
	});

	it("ignores the column on an older trace without one", () => {
		expect(resolve({ location: { file: FILE, line: 40, column: 5 } })).toBe(
			"old",
		);
		expect(
			resolve({
				startTimeMs: TEST_START_MS + 2000,
				location: { file: FILE, line: 40, column: 5 },
			}),
		).toBe("old");
	});
});

describe("resolveViewerHighlights", () => {
	it("leaves out highlights the trace has no span for, keeping the order", () => {
		expect(
			resolveViewerHighlights(
				[
					{ spanId: "click", label: "Clicks" },
					{ spanId: "missing", label: "Gone" },
					{ location: { file: FILE, line: 11 }, at: "start" },
				],
				spans,
			).map(({ span, label, at }) => ({ id: span.id, label, at })),
		).toEqual([
			{ id: "click", label: "Clicks", at: "end" },
			{ id: "fill", label: null, at: "start" },
		]);
	});

	it("keeps a span highlighted twice once, unless it opens elsewhere", () => {
		expect(
			resolveViewerHighlights(
				[
					{ spanId: "click", label: "First" },
					{ startTimeMs: TEST_START_MS + 1200, label: "Again" },
					{ spanId: "click", at: "start" },
				],
				spans,
			).map(({ span, label, at }) => [span.id, label, at]),
		).toEqual([
			["click", "First", "end"],
			["click", null, "start"],
		]);
	});
});
