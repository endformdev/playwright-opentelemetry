import {
	createResource,
	type JSX,
	Match,
	onCleanup,
	type Resource,
	Switch,
} from "solid-js";
import { loadRemoteApi } from "../traceLoader/dataLoaders/apiLoader";
import {
	loadLocalZip,
	loadRemoteZip,
	unloadCurrentTrace,
} from "../traceLoader/dataLoaders/zipLoader";
import type { TraceSource } from "../traceSource";

export interface ResolvedTraceUrls {
	/** URL(s) to fetch OTLP trace JSON from */
	traceDataUrls: string[];
	/** Map of screenshot filename -> URL */
	screenshotUrls: Map<string, string>;
}

export interface TraceLoaderProps {
	/** The trace source to load from */
	source: TraceSource;
	/** Render function for the loaded state */
	children: (urls: ResolvedTraceUrls) => JSX.Element;
}

export function TraceLoader(props: TraceLoaderProps): JSX.Element {
	const resolvedUrls = useTraceLoader(() => props.source);

	return (
		<Switch>
			<Match when={resolvedUrls.loading}>
				<div class="flex flex-1 items-center justify-center">
					<div class="text-center">
						<div class="mb-2">Loading trace...</div>
						<div class="text-sm text-gray-500">
							{props.source.kind === "local-zip" && "Extracting ZIP file..."}
							{props.source.kind === "remote-zip" &&
								"Downloading and extracting ZIP..."}
							{props.source.kind === "remote-api" && "Fetching trace data..."}
						</div>
					</div>
				</div>
			</Match>
			<Match when={resolvedUrls.error}>
				<div class="flex flex-1 items-center justify-center">
					<div class="text-center text-red-600">
						<div class="mb-2 font-semibold">Failed to load trace</div>
						<div class="text-sm">{String(resolvedUrls.error)}</div>
					</div>
				</div>
			</Match>
			<Match when={resolvedUrls()}>{(urls) => props.children(urls())}</Match>
		</Switch>
	);
}

export function useTraceLoader(
	source: () => TraceSource | null,
): Resource<ResolvedTraceUrls | undefined> {
	const [resolvedUrls] = createResource(source, async (src) => {
		if (!src) return undefined;
		return loadTraceSource(src);
	});

	// Cleanup: unload trace from service worker when component unmounts
	onCleanup(() => {
		unloadCurrentTrace();
	});

	return resolvedUrls;
}

async function loadTraceSource(
	source: TraceSource,
): Promise<ResolvedTraceUrls> {
	switch (source.kind) {
		case "local-zip":
			return loadLocalZip(source.file);
		case "remote-zip":
			return loadRemoteZip(source.url);
		case "remote-api":
			return loadRemoteApi(source.url);
	}
}
