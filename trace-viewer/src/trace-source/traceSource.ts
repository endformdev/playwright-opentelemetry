import { type Accessor, createSignal } from "solid-js";

export type TraceSourceSetter = (source: TraceSource | null) => void;

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

export function createTraceSourceSignal(): [
	Accessor<TraceSource | null>,
	TraceSourceSetter,
] {
	const [source, setSourceInternal] = createSignal<TraceSource | null>(
		readFromQueryParam(),
	);

	const setSource: TraceSourceSetter = (value) => {
		setSourceInternal(value);
		writeToQueryParam(value);
	};

	// Handle browser back/forward navigation
	if (typeof window !== "undefined") {
		window.addEventListener("popstate", () => {
			// Update signal from URL without pushing to history
			setSourceInternal(readFromQueryParam());
		});
	}

	return [source, setSource];
}

function readFromQueryParam(): TraceSource | null {
	const params = new URLSearchParams(window.location.search);
	return parseTraceSourceQuery(params.get(QUERY_PARAM_NAME));
}

function writeToQueryParam(source: TraceSource | null): void {
	const params = new URLSearchParams(window.location.search);

	if (source) {
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
			return `local-zip:${source.file.name}`;
		case "remote-zip":
			return source.url;
		case "remote-api":
			return source.url;
	}
}
