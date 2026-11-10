import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createTraceLoadRequestSignal,
	parseTraceSourceInput,
} from "./traceSource";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("trace source input parsing", () => {
	it("parses a remote zip URL", () => {
		expect(
			parseTraceSourceInput("https://example.com/trace.zip", null),
		).toEqual({
			kind: "remote-zip",
			url: "https://example.com/trace.zip",
		});
	});

	it("parses a remote API URL", () => {
		expect(parseTraceSourceInput("https://example.com/api", null)).toEqual({
			kind: "remote-api",
			url: "https://example.com/api",
			traceToken: null,
		});
	});

	it("attaches trace tokens to remote API URLs", () => {
		expect(parseTraceSourceInput("https://example.com/api", " token ")).toEqual(
			{
				kind: "remote-api",
				url: "https://example.com/api",
				traceToken: "token",
			},
		);
	});

	it("extracts trace tokens embedded in remote API URLs", () => {
		expect(
			parseTraceSourceInput(
				"https://example.com/api?traceToken=embedded%20123",
				null,
			),
		).toEqual({
			kind: "remote-api",
			url: "https://example.com/api",
			traceToken: "embedded 123",
		});
	});

	it("drops trace source query params after extracting trace tokens", () => {
		expect(
			parseTraceSourceInput(
				"https://example.com/api?tenant=acme&traceToken=embedded&mode=full",
				null,
			),
		).toEqual({
			kind: "remote-api",
			url: "https://example.com/api",
			traceToken: "embedded",
		});
	});

	it("prefers trace tokens embedded in the trace source URL", () => {
		expect(
			parseTraceSourceInput(
				"https://example.com/api?traceToken=embedded",
				"top-level",
			),
		).toEqual({
			kind: "remote-api",
			url: "https://example.com/api",
			traceToken: "embedded",
		});
	});

	it("extracts trace tokens from relative remote API URLs", () => {
		expect(
			parseTraceSourceInput(
				"/playwright-otel-trace-viewer/v1/trace?traceToken=token",
				null,
			),
		).toEqual({
			kind: "remote-api",
			url: "/playwright-otel-trace-viewer/v1/trace",
			traceToken: "token",
		});
	});

	it("does not attach trace tokens to remote zip URLs", () => {
		expect(
			parseTraceSourceInput("https://example.com/trace.zip", "token"),
		).toEqual({
			kind: "remote-zip",
			url: "https://example.com/trace.zip",
		});
	});

	// needs to be loaded again, can't be deduced from the query string
	it("parses a local zip URL to null", () => {
		expect(parseTraceSourceInput("local-zip", null)).toBeNull();
		expect(parseTraceSourceInput("local-zip:test.zip", null)).toBeNull();
	});

	it("canonicalizes embedded trace tokens into top-level query params", () => {
		const { history } = stubWindow(
			`https://viewer.example.com/?traceSource=${encodeURIComponent("https://example.com/api?traceToken=embedded")}`,
		);

		const [request] = createTraceLoadRequestSignal();

		expect(request()).toEqual({
			origin: "url",
			source: {
				kind: "remote-api",
				url: "https://example.com/api",
				traceToken: "embedded",
			},
			comparison: null,
		});
		expect(history.replaceState).toHaveBeenCalledWith(
			null,
			"",
			"https://viewer.example.com/?traceSource=https%3A%2F%2Fexample.com%2Fapi&traceToken=embedded",
		);
	});

	it("writes UI-entered embedded trace tokens as top-level query params", () => {
		const { history } = stubWindow("https://viewer.example.com/");

		const [, setRequest] = createTraceLoadRequestSignal();
		setRequest(
			parseTraceSourceInput(
				"https://example.com/api?traceToken=ui-token",
				null,
			),
			"ui",
		);

		expect(history.pushState).toHaveBeenCalledWith(
			null,
			"",
			"https://viewer.example.com/?traceSource=https%3A%2F%2Fexample.com%2Fapi&traceToken=ui-token",
		);
	});

	it("writes top-level trace tokens with UI-entered trace sources", () => {
		const { history } = stubWindow(
			"https://viewer.example.com/?traceToken=top-level",
		);

		const [, setRequest] = createTraceLoadRequestSignal();
		setRequest(
			parseTraceSourceInput("https://example.com/api", "top-level"),
			"ui",
		);

		expect(history.pushState).toHaveBeenCalledWith(
			null,
			"",
			"https://viewer.example.com/?traceToken=top-level&traceSource=https%3A%2F%2Fexample.com%2Fapi",
		);
	});
});

describe("comparison trace source", () => {
	const primary = encodeURIComponent("https://a.example.com/api");

	it("reads the comparison with its own token, never the primary's", () => {
		stubWindow(
			`https://viewer.example.com/?traceSource=${primary}&traceToken=token-a&compareSource=${encodeURIComponent("https://b.example.com/api")}`,
		);

		const [request] = createTraceLoadRequestSignal();

		expect(request()?.source).toEqual({
			kind: "remote-api",
			url: "https://a.example.com/api",
			traceToken: "token-a",
		});
		expect(request()?.comparison).toEqual({
			kind: "remote-api",
			url: "https://b.example.com/api",
			traceToken: null,
		});
	});

	it("moves a token embedded in the comparison URL to compareToken", () => {
		const { history } = stubWindow(
			`https://viewer.example.com/?traceSource=${primary}&compareSource=${encodeURIComponent("https://b.example.com/api?traceToken=token-b")}`,
		);

		const [request] = createTraceLoadRequestSignal();

		expect(request()?.comparison).toEqual({
			kind: "remote-api",
			url: "https://b.example.com/api",
			traceToken: "token-b",
		});
		expect(history.replaceState).toHaveBeenCalledWith(
			null,
			"",
			"https://viewer.example.com/?traceSource=https%3A%2F%2Fa.example.com%2Fapi&compareSource=https%3A%2F%2Fb.example.com%2Fapi&compareToken=token-b",
		);
	});

	it("reads a ZIP comparison", () => {
		stubWindow(
			`https://viewer.example.com/?traceSource=${primary}&compareSource=${encodeURIComponent("https://b.example.com/trace.zip")}&compareToken=token-b`,
		);

		const [request] = createTraceLoadRequestSignal();

		expect(request()?.comparison).toEqual({
			kind: "remote-zip",
			url: "https://b.example.com/trace.zip",
		});
	});

	it("does nothing with a comparison and no primary", () => {
		stubWindow(
			`https://viewer.example.com/?compareSource=${encodeURIComponent("https://b.example.com/api")}`,
		);

		const [request] = createTraceLoadRequestSignal();

		expect(request()).toBeNull();
	});

	it("ignores a local ZIP as the comparison", () => {
		stubWindow(
			`https://viewer.example.com/?traceSource=${primary}&compareSource=local-zip`,
		);

		const [request] = createTraceLoadRequestSignal();

		expect(request()?.comparison).toBeNull();
	});

	it("drops the comparison when another trace is loaded", () => {
		const { history } = stubWindow(
			`https://viewer.example.com/?traceSource=${primary}&compareSource=${encodeURIComponent("https://b.example.com/api")}&compareToken=token-b&compareLabel=Main`,
		);

		const [request, setRequest] = createTraceLoadRequestSignal();
		setRequest(parseTraceSourceInput("https://c.example.com/api", null), "ui");

		expect(request()?.comparison).toBeNull();
		expect(history.pushState).toHaveBeenLastCalledWith(
			null,
			"",
			"https://viewer.example.com/?traceSource=https%3A%2F%2Fc.example.com%2Fapi&compareLabel=Main",
		);
	});
});

function stubWindow(href: string): {
	history: {
		pushState: ReturnType<typeof vi.fn>;
		replaceState: ReturnType<typeof vi.fn>;
	};
} {
	let currentUrl = new URL(href);
	const setCurrentUrl = (url: string) => {
		currentUrl = new URL(url);
	};
	const history = {
		pushState: vi.fn((_state: unknown, _title: string, url: string) => {
			setCurrentUrl(url);
		}),
		replaceState: vi.fn((_state: unknown, _title: string, url: string) => {
			setCurrentUrl(url);
		}),
	};
	vi.stubGlobal("window", {
		get location() {
			return currentUrl;
		},
		history,
		addEventListener: vi.fn(),
	});

	return { history };
}
