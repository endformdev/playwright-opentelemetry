import { type Accessor, createSignal } from "solid-js";

export type TraceLoadOrigin = "url" | "ui";

export interface TraceLoadRequest {
	source: TraceSource;
	origin: TraceLoadOrigin;
}

export type TraceLoadRequestSetter = (
	source: TraceSource | null,
	origin?: TraceLoadOrigin,
) => void;

export type TraceSource =
	| LocalZipTraceSource
	| RemoteZipTraceSource
	| RemoteApiTraceSource;

interface LocalZipTraceSource {
	kind: "local-zip";
	file: File;
}

interface RemoteZipTraceSource {
	kind: "remote-zip";
	url: string;
}

interface RemoteApiTraceSource {
	kind: "remote-api";
	url: string;
	traceToken: string | null;
}

const TRACE_SOURCE_QUERY_PARAM_NAME = "traceSource";
const TRACE_TOKEN_QUERY_PARAM_NAME = "traceToken";
const URL_PARSE_BASE = "http://trace-viewer.local";

export function createTraceLoadRequestSignal(): [
	Accessor<TraceLoadRequest | null>,
	TraceLoadRequestSetter,
] {
	const initialRequest = requestFromQueryParam();
	const [request, setRequestInternal] = createSignal<TraceLoadRequest | null>(
		initialRequest,
	);
	if (initialRequest) writeToQueryParam(initialRequest.source, "replace");

	const setRequest: TraceLoadRequestSetter = (source, origin = "ui") => {
		setRequestInternal(source ? { source, origin } : null);
		writeToQueryParam(source, "push");
	};

	// Handle browser back/forward navigation
	if (typeof window !== "undefined") {
		window.addEventListener("popstate", () => {
			// Update signal from URL without pushing to history
			const nextRequest = requestFromQueryParam();
			setRequestInternal(nextRequest);
			if (nextRequest) writeToQueryParam(nextRequest.source, "replace");
		});
	}

	return [request, setRequest];
}

function requestFromQueryParam(): TraceLoadRequest | null {
	const source = readFromQueryParam();
	return source ? { source, origin: "url" } : null;
}

function readFromQueryParam(): TraceSource | null {
	const params = new URLSearchParams(window.location.search);
	return parseTraceSourceInput(
		params.get(TRACE_SOURCE_QUERY_PARAM_NAME),
		readTraceTokenQueryParam(),
	);
}

export function readTraceTokenQueryParam(): string | null {
	if (typeof window === "undefined") return null;
	const params = new URLSearchParams(window.location.search);
	return params.get(TRACE_TOKEN_QUERY_PARAM_NAME);
}

function writeToQueryParam(
	source: TraceSource | null,
	historyMode: "push" | "replace",
): void {
	const params = new URLSearchParams(window.location.search);

	if (source && source.kind !== "local-zip") {
		params.set(TRACE_SOURCE_QUERY_PARAM_NAME, serializeTraceSource(source));
	} else {
		params.delete(TRACE_SOURCE_QUERY_PARAM_NAME);
	}

	if (source?.kind === "remote-api" && source.traceToken) {
		params.set(TRACE_TOKEN_QUERY_PARAM_NAME, source.traceToken);
	} else {
		params.delete(TRACE_TOKEN_QUERY_PARAM_NAME);
	}

	const url = new URL(window.location.href);
	url.search = params.toString();

	if (historyMode === "replace") {
		window.history.replaceState(null, "", url.toString());
	} else {
		window.history.pushState(null, "", url.toString());
	}
}

export function parseTraceSourceInput(
	traceSource: string | null,
	fallbackTraceToken: string | null,
): TraceSource | null {
	if (!traceSource || traceSource.trim() === "") {
		return null;
	}

	const trimmedTraceSource = traceSource.trim();

	if (
		trimmedTraceSource === "local-zip" ||
		trimmedTraceSource.startsWith("local-zip:")
	) {
		return null;
	}

	const normalized = normalizeTraceSourceUrl(
		trimmedTraceSource,
		fallbackTraceToken,
	);

	if (isZipUrl(normalized.url)) {
		return { kind: "remote-zip", url: normalized.url };
	}

	return {
		kind: "remote-api",
		url: normalized.url,
		traceToken: normalized.traceToken,
	};
}

function normalizeTraceSourceUrl(
	value: string,
	topLevelTraceToken: string | null,
): { url: string; traceToken: string | null } {
	const trimmedTopLevelTraceToken = topLevelTraceToken?.trim();

	try {
		const parsedUrl = new URL(value, URL_PARSE_BASE);
		const embeddedTraceToken = parsedUrl.searchParams
			.get(TRACE_TOKEN_QUERY_PARAM_NAME)
			?.trim();

		return {
			url: withoutQueryOrHash(value),
			traceToken: embeddedTraceToken || trimmedTopLevelTraceToken || null,
		};
	} catch {
		return {
			url: withoutQueryOrHash(value),
			traceToken: trimmedTopLevelTraceToken || null,
		};
	}
}

function isZipUrl(value: string): boolean {
	return value.toLowerCase().endsWith(".zip");
}

function withoutQueryOrHash(value: string): string {
	return value.split(/[?#]/, 1)[0];
}

function serializeTraceSource(source: TraceSource): string {
	switch (source.kind) {
		case "local-zip":
			throw new Error("Local ZIP trace sources cannot be serialized");
		case "remote-zip":
			return source.url;
		case "remote-api":
			return source.url;
	}
}
