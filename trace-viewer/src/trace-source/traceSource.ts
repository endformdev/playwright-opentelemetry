import { type Accessor, createSignal } from "solid-js";

export type TraceLoadOrigin = "url" | "ui";

export interface TraceLoadRequest {
	source: TraceSource;
	origin: TraceLoadOrigin;
	/**
	 * A second trace to show beside the first, named by `compareSource` and
	 * `compareToken` in the URL; null without one
	 */
	comparison: TraceSource | null;
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
const COMPARE_SOURCE_QUERY_PARAM_NAME = "compareSource";
const COMPARE_TOKEN_QUERY_PARAM_NAME = "compareToken";
const URL_PARSE_BASE = "http://trace-viewer.local";

export function createTraceLoadRequestSignal(): [
	Accessor<TraceLoadRequest | null>,
	TraceLoadRequestSetter,
] {
	const initialRequest = requestFromQueryParam();
	const [request, setRequestInternal] = createSignal<TraceLoadRequest | null>(
		initialRequest,
	);
	if (initialRequest) writeToQueryParam(initialRequest, "replace");

	// Loading another trace drops the comparison: it was chosen for the last one.
	const setRequest: TraceLoadRequestSetter = (source, origin = "ui") => {
		const nextRequest = source ? { source, origin, comparison: null } : null;
		setRequestInternal(nextRequest);
		writeToQueryParam(nextRequest, "push");
	};

	// Handle browser back/forward navigation
	if (typeof window !== "undefined") {
		window.addEventListener("popstate", () => {
			// Update signal from URL without pushing to history
			const nextRequest = requestFromQueryParam();
			setRequestInternal(nextRequest);
			if (nextRequest) writeToQueryParam(nextRequest, "replace");
		});
	}

	return [request, setRequest];
}

function requestFromQueryParam(): TraceLoadRequest | null {
	const params = new URLSearchParams(window.location.search);
	const source = parseTraceSourceInput(
		params.get(TRACE_SOURCE_QUERY_PARAM_NAME),
		params.get(TRACE_TOKEN_QUERY_PARAM_NAME),
	);
	if (!source) return null;
	// Each source has its own token: the two can be on different origins.
	const comparison = parseTraceSourceInput(
		params.get(COMPARE_SOURCE_QUERY_PARAM_NAME),
		params.get(COMPARE_TOKEN_QUERY_PARAM_NAME),
	);
	return { source, origin: "url", comparison };
}

export function readTraceTokenQueryParam(): string | null {
	if (typeof window === "undefined") return null;
	const params = new URLSearchParams(window.location.search);
	return params.get(TRACE_TOKEN_QUERY_PARAM_NAME);
}

function writeToQueryParam(
	request: TraceLoadRequest | null,
	historyMode: "push" | "replace",
): void {
	const params = new URLSearchParams(window.location.search);
	writeSourceParams(
		params,
		request?.source ?? null,
		TRACE_SOURCE_QUERY_PARAM_NAME,
		TRACE_TOKEN_QUERY_PARAM_NAME,
	);
	writeSourceParams(
		params,
		request?.comparison ?? null,
		COMPARE_SOURCE_QUERY_PARAM_NAME,
		COMPARE_TOKEN_QUERY_PARAM_NAME,
	);

	const url = new URL(window.location.href);
	url.search = params.toString();

	if (historyMode === "replace") {
		window.history.replaceState(null, "", url.toString());
	} else {
		window.history.pushState(null, "", url.toString());
	}
}

function writeSourceParams(
	params: URLSearchParams,
	source: TraceSource | null,
	sourceParamName: string,
	tokenParamName: string,
): void {
	if (source && source.kind !== "local-zip") {
		params.set(sourceParamName, serializeTraceSource(source));
	} else {
		params.delete(sourceParamName);
	}

	if (source?.kind === "remote-api" && source.traceToken) {
		params.set(tokenParamName, source.traceToken);
	} else {
		params.delete(tokenParamName);
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
