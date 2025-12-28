import { describe, expect, it } from "vitest";
import { categorizeSpan, categorizeSpans, mergeSpans } from "./categorizeSpans";
import type { NormalizedSpan } from "./normalizeSpans";

describe("categorizeSpan", () => {
	it("categorizes playwright.test as step", () => {
		const span = createSpan({ name: "playwright.test" });
		expect(categorizeSpan(span)).toBe("step");
	});

	it("categorizes playwright.test.step as step", () => {
		const span = createSpan({ name: "playwright.test.step" });
		expect(categorizeSpan(span)).toBe("step");
	});

	it("categorizes HTTP spans as span", () => {
		const span = createSpan({ name: "HTTP GET" });
		expect(categorizeSpan(span)).toBe("span");
	});

	it("categorizes unknown spans as span", () => {
		const span = createSpan({ name: "some.custom.span" });
		expect(categorizeSpan(span)).toBe("span");
	});

	it("categorizes DB spans as span", () => {
		const span = createSpan({ name: "DB SELECT users" });
		expect(categorizeSpan(span)).toBe("span");
	});
});

describe("categorizeSpans", () => {
	it("returns empty arrays for empty input", () => {
		const result = categorizeSpans([]);
		expect(result.steps).toEqual([]);
		expect(result.spans).toEqual([]);
	});

	it("separates steps and spans correctly", () => {
		const allSpans = [
			createSpan({ id: "1", name: "playwright.test" }),
			createSpan({ id: "2", name: "HTTP GET" }),
			createSpan({ id: "3", name: "playwright.test.step" }),
			createSpan({ id: "4", name: "DB Query" }),
		];

		const result = categorizeSpans(allSpans);

		expect(result.steps).toHaveLength(2);
		expect(result.steps.map((s) => s.id)).toEqual(["1", "3"]);

		expect(result.spans).toHaveLength(2);
		expect(result.spans.map((s) => s.id)).toEqual(["2", "4"]);
	});

	it("handles all steps", () => {
		const allSpans = [
			createSpan({ id: "1", name: "playwright.test" }),
			createSpan({ id: "2", name: "playwright.test.step" }),
		];

		const result = categorizeSpans(allSpans);

		expect(result.steps).toHaveLength(2);
		expect(result.spans).toHaveLength(0);
	});

	it("handles all spans (no steps)", () => {
		const allSpans = [
			createSpan({ id: "1", name: "HTTP GET" }),
			createSpan({ id: "2", name: "gRPC call" }),
		];

		const result = categorizeSpans(allSpans);

		expect(result.steps).toHaveLength(0);
		expect(result.spans).toHaveLength(2);
	});
});

describe("mergeSpans", () => {
	it("merges empty arrays", () => {
		const existing = { steps: [], spans: [] };
		const incoming = { steps: [], spans: [] };

		const result = mergeSpans(existing, incoming);

		expect(result.steps).toEqual([]);
		expect(result.spans).toEqual([]);
	});

	it("merges incoming into empty existing", () => {
		const existing = { steps: [], spans: [] };
		const incoming = {
			steps: [createSpan({ id: "s1", name: "playwright.test.step" })],
			spans: [createSpan({ id: "h1", name: "HTTP GET" })],
		};

		const result = mergeSpans(existing, incoming);

		expect(result.steps).toHaveLength(1);
		expect(result.spans).toHaveLength(1);
	});

	it("merges existing into incoming", () => {
		const existing = {
			steps: [createSpan({ id: "s1", name: "playwright.test.step" })],
			spans: [createSpan({ id: "h1", name: "HTTP GET" })],
		};
		const incoming = { steps: [], spans: [] };

		const result = mergeSpans(existing, incoming);

		expect(result.steps).toHaveLength(1);
		expect(result.spans).toHaveLength(1);
	});

	it("sorts merged steps by startOffsetMs", () => {
		const existing = {
			steps: [
				createSpan({
					id: "s2",
					name: "playwright.test.step",
					startOffsetMs: 200,
				}),
			],
			spans: [],
		};
		const incoming = {
			steps: [
				createSpan({
					id: "s1",
					name: "playwright.test.step",
					startOffsetMs: 100,
				}),
				createSpan({
					id: "s3",
					name: "playwright.test.step",
					startOffsetMs: 300,
				}),
			],
			spans: [],
		};

		const result = mergeSpans(existing, incoming);

		expect(result.steps.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
	});

	it("sorts merged spans by startOffsetMs", () => {
		const existing = {
			steps: [],
			spans: [createSpan({ id: "h2", name: "HTTP GET", startOffsetMs: 200 })],
		};
		const incoming = {
			steps: [],
			spans: [
				createSpan({ id: "h1", name: "HTTP GET", startOffsetMs: 100 }),
				createSpan({ id: "h3", name: "HTTP GET", startOffsetMs: 300 }),
			],
		};

		const result = mergeSpans(existing, incoming);

		expect(result.spans.map((s) => s.id)).toEqual(["h1", "h2", "h3"]);
	});

	it("maintains separate arrays for steps and spans during merge", () => {
		const existing = {
			steps: [
				createSpan({
					id: "s1",
					name: "playwright.test.step",
					startOffsetMs: 0,
				}),
			],
			spans: [createSpan({ id: "h1", name: "HTTP GET", startOffsetMs: 50 })],
		};
		const incoming = {
			steps: [
				createSpan({
					id: "s2",
					name: "playwright.test.step",
					startOffsetMs: 100,
				}),
			],
			spans: [createSpan({ id: "h2", name: "HTTP POST", startOffsetMs: 150 })],
		};

		const result = mergeSpans(existing, incoming);

		expect(result.steps).toHaveLength(2);
		expect(result.spans).toHaveLength(2);
		expect(result.steps.every((s) => s.name === "playwright.test.step")).toBe(
			true,
		);
		expect(result.spans.every((s) => s.name.startsWith("HTTP"))).toBe(true);
	});
});

function createSpan(overrides: Partial<NormalizedSpan> = {}): NormalizedSpan {
	return {
		id: "span1",
		parentId: null,
		traceId: "trace1",
		name: "test.span",
		title: "Test Span",
		startOffsetMs: 0,
		durationMs: 100,
		kind: "internal",
		attributes: {},
		...overrides,
	};
}
