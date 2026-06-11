import { ErrorBoundary, Match, Switch } from "solid-js";
import {
	TraceLoadInterface,
	type TraceLoadInterfaceStatus,
} from "./TraceLoadInterface";
import { useTraceInfoLoader } from "./trace-info-loader";
import { createTraceLoadRequestSignal, type TraceSource } from "./trace-source";
import { TraceViewer } from "./trace-viewer";

export default function App() {
	const [loadRequest, setLoadRequest] = createTraceLoadRequestSignal();
	const { traceInfoData, traceInfo } = useTraceInfoLoader(
		() => loadRequest()?.source ?? null,
	);
	const loadedTraceInfo = () => (loadRequest() ? traceInfo() : undefined);
	const urlLoadingSource = () => {
		const request = loadRequest();
		if (request?.origin !== "url" || !traceInfoData.loading) {
			return undefined;
		}
		return request.source;
	};
	const traceLoadInterfaceStatus = (): TraceLoadInterfaceStatus => {
		const request = loadRequest();
		if (!request) return { kind: "idle" };

		if (request.origin === "ui" && traceInfoData.loading) {
			return {
				kind: "loading",
				message: loadingMessage(request.source),
			};
		}

		if (traceInfoData.error) {
			return { kind: "error", message: String(traceInfoData.error) };
		}

		return { kind: "idle" };
	};
	const initialApiUrl = () => traceSourceUrl(loadRequest()?.source);

	return (
		<ErrorBoundary
			fallback={(error, reset) => (
				<div>
					<h1>Error</h1>
					<p>{error.message}</p>
					<button type="button" onClick={reset}>
						Try Again
					</button>
				</div>
			)}
		>
			<div class="flex h-screen w-screen">
				<Switch
					fallback={
						<TraceLoadInterface
							initialApiUrl={initialApiUrl()}
							status={traceLoadInterfaceStatus()}
							onLoadSource={(source) => setLoadRequest(source, "ui")}
						/>
					}
				>
					<Match when={loadedTraceInfo()}>
						{(info) => <TraceViewer traceInfo={info()} />}
					</Match>
					<Match when={urlLoadingSource()}>
						{(source) => <TraceLoading source={source()} />}
					</Match>
				</Switch>
			</div>
		</ErrorBoundary>
	);
}

function TraceLoading(props: { source: TraceSource }) {
	return (
		<div class="flex flex-1 items-center justify-center">
			<div class="text-center">
				<div class="mb-2">Loading trace...</div>
				<div class="text-sm text-gray-500">{loadingMessage(props.source)}</div>
			</div>
		</div>
	);
}

function loadingMessage(source: TraceSource): string {
	switch (source.kind) {
		case "local-zip":
			return "Extracting ZIP file...";
		case "remote-zip":
			return "Downloading and extracting ZIP...";
		case "remote-api":
			return "Fetching trace data...";
	}
}

function traceSourceUrl(source: TraceSource | undefined): string | undefined {
	if (!source) return undefined;
	switch (source.kind) {
		case "remote-api":
		case "remote-zip":
			return source.url;
		case "local-zip":
			return undefined;
	}
}
