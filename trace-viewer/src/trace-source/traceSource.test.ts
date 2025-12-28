import { describe, expect, it } from "vitest";
import { parseTraceSourceQuery } from "./traceSource";

describe("reading from an existing query string", () => {
	it("parses a remote zip URL", () => {
		expect(parseTraceSourceQuery("https://example.com/trace.zip")).toEqual({
			kind: "remote-zip",
			url: "https://example.com/trace.zip",
		});
	});

	it("parses a remote API URL", () => {
		expect(parseTraceSourceQuery("https://example.com/api")).toEqual({
			kind: "remote-api",
			url: "https://example.com/api",
		});
	});

	// needs to be loaded again, can't be deduced from the query string
	it("parses a local zip URL to null", () => {
		expect(parseTraceSourceQuery("local-zip")).toBeNull();
		expect(parseTraceSourceQuery("local-zip:test.zip")).toBeNull();
	});
});
