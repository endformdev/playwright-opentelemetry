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
}

const QUERY_PARAM_NAME = "traceSource";

export function createTraceLoadRequestSignal(): [
	Accessor<TraceLoadRequest | null>,
	TraceLoadRequestSetter,
] {
	const [request, setRequestInternal] = createSignal<TraceLoadRequest | null>(
		requestFromQueryParam(),
	);

	const setRequest: TraceLoadRequestSetter = (source, origin = "ui") => {
		setRequestInternal(source ? { source, origin } : null);
		writeToQueryParam(source);
	};

	// Handle browser back/forward navigation
	if (typeof window !== "undefined") {
		window.addEventListener("popstate", () => {
			// Update signal from URL without pushing to history
			setRequestInternal(requestFromQueryParam());
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
	return parseTraceSourceQuery(params.get(QUERY_PARAM_NAME));
}

function writeToQueryParam(source: TraceSource | null): void {
	const params = new URLSearchParams(window.location.search);

	if (source && source.kind !== "local-zip") {
		params.set(QUERY_PARAM_NAME, serializeTraceSource(source));
	} else {
		params.delete(QUERY_PARAM_NAME);
	}

	const url = new URL(window.location.href);
	url.search = params.toString();

	window.history.pushState(null, "", url.toString());
}

export function parseTraceSourceQuery(
	value: string | null,
): TraceSource | null {
	if (!value || value.trim() === "") {
		return null;
	}

	const trimmed = value.trim();

	if (trimmed === "local-zip" || trimmed.startsWith("local-zip:")) {
		return null;
	}

	if (trimmed.endsWith(".zip")) {
		return { kind: "remote-zip", url: trimmed };
	}

	return { kind: "remote-api", url: trimmed };
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
