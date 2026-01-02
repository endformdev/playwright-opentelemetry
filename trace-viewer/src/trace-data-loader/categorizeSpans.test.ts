import { describe, expect, it } from "vitest";
import { categorizeSpan, categorizeSpans, mergeSpans } from "./categorizeSpans";
import type { Span } from "./exportToSpans";

describe("categorizeSpan", () => {
	it("categorizes playwright.test as step", () => {
		const span = createSpan({ name: "playwright.test" });
		expect(categorizeSpan(span)).toBe("step");
	});

	it("categorizes playwright.test.step as step", () => {
		const span = createSpan({ name: "playwright.test.step" });
		expect(categorizeSpan(span)).toBe("step");
	});

	it("categorizes playwright-browser spans as browserSpan", () => {
		const span = createSpan({
			name: "HTTP GET",
			serviceName: "playwright-browser",
		});
		expect(categorizeSpan(span)).toBe("browserSpan");
	});

	it("categorizes HTTP spans as externalSpan", () => {
		const span = createSpan({ name: "HTTP GET", serviceName: "api-service" });
		expect(categorizeSpan(span)).toBe("externalSpan");
	});

	it("categorizes unknown spans as externalSpan", () => {
		const span = createSpan({
			name: "some.custom.span",
			serviceName: "custom-service",
		});
		expect(categorizeSpan(span)).toBe("externalSpan");
	});

	it("categorizes DB spans as externalSpan", () => {
		const span = createSpan({
			name: "DB SELECT users",
			serviceName: "db-service",
		});
		expect(categorizeSpan(span)).toBe("externalSpan");
	});
});

describe("categorizeSpans", () => {
	it("returns empty arrays for empty input", () => {
		const result = categorizeSpans([]);
		expect(result.steps).toEqual([]);
		expect(result.browserSpans).toEqual([]);
		expect(result.externalSpans).toEqual([]);
	});

	it("separates steps, browser spans, and external spans correctly", () => {
		const allSpans = [
			createSpan({ id: "1", name: "playwright.test" }),
			createSpan({
				id: "2",
				name: "HTTP GET",
				serviceName: "playwright-browser",
			}),
			createSpan({ id: "3", name: "playwright.test.step" }),
			createSpan({ id: "4", name: "DB Query", serviceName: "db-service" }),
			createSpan({
				id: "5",
				name: "HTTP POST",
				serviceName: "playwright-browser",
			}),
		];

		const result = categorizeSpans(allSpans);

		expect(result.steps).toHaveLength(2);
		expect(result.steps.map((s) => s.id)).toEqual(["1", "3"]);

		expect(result.browserSpans).toHaveLength(2);
		expect(result.browserSpans.map((s) => s.id)).toEqual(["2", "5"]);

		expect(result.externalSpans).toHaveLength(1);
		expect(result.externalSpans.map((s) => s.id)).toEqual(["4"]);
	});

	it("handles all steps", () => {
		const allSpans = [
			createSpan({ id: "1", name: "playwright.test" }),
			createSpan({ id: "2", name: "playwright.test.step" }),
		];

		const result = categorizeSpans(allSpans);

		expect(result.steps).toHaveLength(2);
		expect(result.browserSpans).toHaveLength(0);
		expect(result.externalSpans).toHaveLength(0);
	});

	it("handles browser spans only", () => {
		const allSpans = [
			createSpan({
				id: "1",
				name: "HTTP GET",
				serviceName: "playwright-browser",
			}),
			createSpan({
				id: "2",
				name: "HTTP POST",
				serviceName: "playwright-browser",
			}),
		];

		const result = categorizeSpans(allSpans);

		expect(result.steps).toHaveLength(0);
		expect(result.browserSpans).toHaveLength(2);
		expect(result.externalSpans).toHaveLength(0);
	});

	it("handles external spans only", () => {
		const allSpans = [
			createSpan({ id: "1", name: "HTTP GET", serviceName: "api-service" }),
			createSpan({ id: "2", name: "gRPC call", serviceName: "grpc-service" }),
		];

		const result = categorizeSpans(allSpans);

		expect(result.steps).toHaveLength(0);
		expect(result.browserSpans).toHaveLength(0);
		expect(result.externalSpans).toHaveLength(2);
	});
});

describe("mergeSpans", () => {
	it("merges empty arrays", () => {
		const existing = { steps: [], browserSpans: [], externalSpans: [] };
		const incoming = { steps: [], browserSpans: [], externalSpans: [] };

		const result = mergeSpans(existing, incoming);

		expect(result.steps).toEqual([]);
		expect(result.browserSpans).toEqual([]);
		expect(result.externalSpans).toEqual([]);
	});

	it("merges incoming into empty existing", () => {
		const existing = { steps: [], browserSpans: [], externalSpans: [] };
		const incoming = {
			steps: [createSpan({ id: "s1", name: "playwright.test.step" })],
			browserSpans: [
				createSpan({
					id: "b1",
					name: "HTTP GET",
					serviceName: "playwright-browser",
				}),
			],
			externalSpans: [
				createSpan({ id: "e1", name: "HTTP GET", serviceName: "api-service" }),
			],
		};

		const result = mergeSpans(existing, incoming);

		expect(result.steps).toHaveLength(1);
		expect(result.browserSpans).toHaveLength(1);
		expect(result.externalSpans).toHaveLength(1);
	});

	it("merges existing into incoming", () => {
		const existing = {
			steps: [createSpan({ id: "s1", name: "playwright.test.step" })],
			browserSpans: [
				createSpan({
					id: "b1",
					name: "HTTP GET",
					serviceName: "playwright-browser",
				}),
			],
			externalSpans: [
				createSpan({ id: "e1", name: "HTTP GET", serviceName: "api-service" }),
			],
		};
		const incoming = { steps: [], browserSpans: [], externalSpans: [] };

		const result = mergeSpans(existing, incoming);

		expect(result.steps).toHaveLength(1);
		expect(result.browserSpans).toHaveLength(1);
		expect(result.externalSpans).toHaveLength(1);
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
			browserSpans: [],
			externalSpans: [],
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
			browserSpans: [],
			externalSpans: [],
		};

		const result = mergeSpans(existing, incoming);

		expect(result.steps.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
	});

	it("sorts merged browser spans by startOffsetMs", () => {
		const existing = {
			steps: [],
			browserSpans: [
				createSpan({
					id: "b2",
					name: "HTTP GET",
					serviceName: "playwright-browser",
					startOffsetMs: 200,
				}),
			],
			externalSpans: [],
		};
		const incoming = {
			steps: [],
			browserSpans: [
				createSpan({
					id: "b1",
					name: "HTTP GET",
					serviceName: "playwright-browser",
					startOffsetMs: 100,
				}),
				createSpan({
					id: "b3",
					name: "HTTP GET",
					serviceName: "playwright-browser",
					startOffsetMs: 300,
				}),
			],
			externalSpans: [],
		};

		const result = mergeSpans(existing, incoming);

		expect(result.browserSpans.map((s) => s.id)).toEqual(["b1", "b2", "b3"]);
	});

	it("sorts merged external spans by startOffsetMs", () => {
		const existing = {
			steps: [],
			browserSpans: [],
			externalSpans: [
				createSpan({
					id: "e2",
					name: "HTTP GET",
					serviceName: "api-service",
					startOffsetMs: 200,
				}),
			],
		};
		const incoming = {
			steps: [],
			browserSpans: [],
			externalSpans: [
				createSpan({
					id: "e1",
					name: "HTTP GET",
					serviceName: "api-service",
					startOffsetMs: 100,
				}),
				createSpan({
					id: "e3",
					name: "HTTP GET",
					serviceName: "api-service",
					startOffsetMs: 300,
				}),
			],
		};

		const result = mergeSpans(existing, incoming);

		expect(result.externalSpans.map((s) => s.id)).toEqual(["e1", "e2", "e3"]);
	});

	it("maintains separate arrays for steps, browser spans, and external spans during merge", () => {
		const existing = {
			steps: [
				createSpan({
					id: "s1",
					name: "playwright.test.step",
					startOffsetMs: 0,
				}),
			],
			browserSpans: [
				createSpan({
					id: "b1",
					name: "HTTP GET",
					serviceName: "playwright-browser",
					startOffsetMs: 50,
				}),
			],
			externalSpans: [
				createSpan({
					id: "e1",
					name: "HTTP GET",
					serviceName: "api-service",
					startOffsetMs: 75,
				}),
			],
		};
		const incoming = {
			steps: [
				createSpan({
					id: "s2",
					name: "playwright.test.step",
					startOffsetMs: 100,
				}),
			],
			browserSpans: [
				createSpan({
					id: "b2",
					name: "HTTP POST",
					serviceName: "playwright-browser",
					startOffsetMs: 150,
				}),
			],
			externalSpans: [
				createSpan({
					id: "e2",
					name: "HTTP POST",
					serviceName: "api-service",
					startOffsetMs: 175,
				}),
			],
		};

		const result = mergeSpans(existing, incoming);

		expect(result.steps).toHaveLength(2);
		expect(result.browserSpans).toHaveLength(2);
		expect(result.externalSpans).toHaveLength(2);
		expect(result.steps.every((s) => s.name === "playwright.test.step")).toBe(
			true,
		);
		expect(
			result.browserSpans.every((s) => s.serviceName === "playwright-browser"),
		).toBe(true);
		expect(
			result.externalSpans.every((s) => s.serviceName === "api-service"),
		).toBe(true);
	});
});

function createSpan(overrides: Partial<Span> = {}): Span {
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
		serviceName: "unknown",
		...overrides,
	};
}
