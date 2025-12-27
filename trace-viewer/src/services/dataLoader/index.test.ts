import { describe, expect, it } from "vitest";
import { parseTraceSourceParam } from "./index";

describe("parseTraceSourceParam", () => {
	it("returns null for null input", () => {
		expect(parseTraceSourceParam(null)).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(parseTraceSourceParam("")).toBeNull();
	});

	it("parses remote zip URL ending with .zip", () => {
		const result = parseTraceSourceParam("https://example.com/traces/test.zip");
		expect(result).toEqual({
			kind: "remote-zip",
			url: "https://example.com/traces/test.zip",
		});
	});

	it("parses .ZIP extension (case-sensitive - treated as API)", () => {
		// Note: Current implementation is case-sensitive, .ZIP is not matched
		const result = parseTraceSourceParam("https://example.com/traces/test.ZIP");
		expect(result).toEqual({
			kind: "remote-api",
			baseUrl: "https://example.com/traces/test.ZIP",
		});
	});

	it("parses remote API URL without .zip extension", () => {
		const result = parseTraceSourceParam("https://example.com/traces/abc123");
		expect(result).toEqual({
			kind: "remote-api",
			baseUrl: "https://example.com/traces/abc123",
		});
	});

	it("parses URL with query parameters as remote API", () => {
		const result = parseTraceSourceParam(
			"https://example.com/traces/abc123?token=xyz",
		);
		expect(result).toEqual({
			kind: "remote-api",
			baseUrl: "https://example.com/traces/abc123?token=xyz",
		});
	});

	it("parses localhost URL as remote API", () => {
		const result = parseTraceSourceParam("http://localhost:3000/traces/test");
		expect(result).toEqual({
			kind: "remote-api",
			baseUrl: "http://localhost:3000/traces/test",
		});
	});

	it("parses localhost URL with .zip as remote zip", () => {
		const result = parseTraceSourceParam(
			"http://localhost:3000/traces/test.zip",
		);
		expect(result).toEqual({
			kind: "remote-zip",
			url: "http://localhost:3000/traces/test.zip",
		});
	});
});
