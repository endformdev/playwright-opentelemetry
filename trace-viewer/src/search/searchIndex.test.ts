import { describe, expect, it } from "vitest";
import type { Span } from "../trace-data-loader/exportToSpans";
import { normalizeKey, normalizeQuery } from "./normalizers";
import { buildHaystack, buildSearchIndex, searchSpans } from "./searchIndex";

describe("normalizers", () => {
	describe("normalizeKey", () => {
		it("converts dots to spaces", () => {
			expect(normalizeKey("http.response.status_code")).toBe(
				"http response status code",
			);
		});

		it("converts underscores to spaces", () => {
			expect(normalizeKey("test_case_title")).toBe("test case title");
		});

		it("lowercases", () => {
			expect(normalizeKey("HTTP.Response")).toBe("http response");
		});

		it("handles mixed separators", () => {
			expect(normalizeKey("http.status_code")).toBe("http status code");
		});
	});

	describe("normalizeQuery", () => {
		it("removes colons", () => {
			expect(normalizeQuery("http: 200")).toBe("http 200");
		});

		it("collapses whitespace", () => {
			expect(normalizeQuery("  status   code  ")).toBe("status code");
		});

		it("lowercases", () => {
			expect(normalizeQuery("HTTP Status")).toBe("http status");
		});

		it("combines all normalizations", () => {
			expect(normalizeQuery("  HTTP:  200  ")).toBe("http 200");
		});
	});
});

describe("searchIndex", () => {
	const mockSpans: Span[] = [
		{
			id: "span1",
			parentId: null,
			traceId: "trace1",
			name: "HTTP GET",
			title: "GET /api/users",
			startOffsetMs: 0,
			durationMs: 100,
			kind: "client",
			attributes: {
				"http.method": "GET",
				"http.url": "/api/users",
				"http.status_code": 200,
			},
			serviceName: "api-service",
		},
		{
			id: "span2",
			parentId: "span1",
			traceId: "trace1",
			name: "database query",
			title: "SELECT users",
			startOffsetMs: 10,
			durationMs: 50,
			kind: "internal",
			attributes: {
				"db.system": "postgresql",
				"db.statement": "SELECT * FROM users",
			},
			serviceName: "api-service",
		},
		{
			id: "span3",
			parentId: null,
			traceId: "trace1",
			name: "HTTP POST",
			title: "POST /api/users",
			startOffsetMs: 200,
			durationMs: 150,
			kind: "server",
			attributes: {
				"http.method": "POST",
				"http.url": "/api/users",
				"http.status_code": 201,
			},
			serviceName: "api-service",
		},
	];

	describe("buildSearchIndex", () => {
		it("indexes all span attributes", () => {
			const index = buildSearchIndex(mockSpans);

			// span1 has 3 attributes + 4 special fields = 7 entries
			// span2 has 2 attributes + 4 special fields = 6 entries
			// span3 has 3 attributes + 4 special fields = 7 entries
			// Total: 20 entries
			expect(index.length).toBe(20);
		});

		it("normalizes keys in search text", () => {
			const index = buildSearchIndex(mockSpans);

			const httpStatusEntry = index.find(
				(entry) => entry.key === "http.status_code" && entry.spanId === "span1",
			);

			expect(httpStatusEntry).toBeDefined();
			expect(httpStatusEntry?.searchText).toBe("http status code 200");
		});

		it("includes special fields", () => {
			const index = buildSearchIndex(mockSpans);

			const kindEntry = index.find(
				(entry) => entry.key === "kind" && entry.spanId === "span1",
			);
			const nameEntry = index.find(
				(entry) => entry.key === "name" && entry.spanId === "span1",
			);

			expect(kindEntry?.value).toBe("client");
			expect(nameEntry?.value).toBe("HTTP GET");
		});
	});

	describe("buildHaystack", () => {
		it("creates array of search texts", () => {
			const index = buildSearchIndex(mockSpans);
			const haystack = buildHaystack(index);

			expect(haystack.length).toBe(index.length);
			expect(haystack).toContain("http status code 200");
			expect(haystack).toContain("db system postgresql");
		});
	});

	describe("searchSpans", () => {
		it("finds exact matches", () => {
			const index = buildSearchIndex(mockSpans);
			const haystack = buildHaystack(index);

			const results = searchSpans(index, haystack, "postgresql", mockSpans);

			expect(results.length).toBeGreaterThan(0);
			expect(results[0].spanId).toBe("span2");
		});

		it("finds fuzzy matches", () => {
			const index = buildSearchIndex(mockSpans);
			const haystack = buildHaystack(index);

			// "http 200" should match "http.status_code: 200"
			const results = searchSpans(index, haystack, "http 200", mockSpans);

			expect(results.length).toBeGreaterThan(0);
			const span1Match = results.find((r) => r.spanId === "span1");
			expect(span1Match).toBeDefined();
		});

		it("matches on kind", () => {
			const index = buildSearchIndex(mockSpans);
			const haystack = buildHaystack(index);

			const results = searchSpans(index, haystack, "client", mockSpans);

			expect(results.length).toBeGreaterThan(0);
			const clientSpan = results.find((r) => r.spanId === "span1");
			expect(clientSpan).toBeDefined();
		});

		it("returns empty array for no matches", () => {
			const index = buildSearchIndex(mockSpans);
			const haystack = buildHaystack(index);

			const results = searchSpans(index, haystack, "nonexistent", mockSpans);

			expect(results).toEqual([]);
		});

		it("returns empty array for empty query", () => {
			const index = buildSearchIndex(mockSpans);
			const haystack = buildHaystack(index);

			const results = searchSpans(index, haystack, "", mockSpans);

			expect(results).toEqual([]);
		});

		it("includes span metadata in results", () => {
			const index = buildSearchIndex(mockSpans);
			const haystack = buildHaystack(index);

			const results = searchSpans(index, haystack, "postgresql", mockSpans);

			expect(results[0].spanName).toBe("database query");
			expect(results[0].spanTitle).toBe("SELECT users");
		});

		it("includes highlight ranges", () => {
			const index = buildSearchIndex(mockSpans);
			const haystack = buildHaystack(index);

			const results = searchSpans(index, haystack, "200", mockSpans);

			expect(results.length).toBeGreaterThan(0);
			expect(results[0].ranges).toBeDefined();
			expect(Array.isArray(results[0].ranges)).toBe(true);
		});
	});
});
