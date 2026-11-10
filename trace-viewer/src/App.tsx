import { ErrorBoundary, Match, Switch } from "solid-js";
import { TraceAccessDenied } from "./TraceAccessDenied";
import {
	TraceLoadInterface,
	type TraceLoadInterfaceStatus,
} from "./TraceLoadInterface";
import { TraceAccessError, useTraceInfoLoader } from "./trace-info-loader";
import { createTraceLoadRequestSignal, type TraceSource } from "./trace-source";
import { TraceViewer, TraceViewerSkeleton } from "./trace-viewer";
import { readViewerActionFromQueryParams } from "./trace-viewer/viewerAction";
import {
	readComparisonLabelFromQueryParams,
	type ViewerComparison,
} from "./trace-viewer/viewerComparison";
import { readViewerHighlightFromQueryParams } from "./trace-viewer/viewerHighlight";
import { readViewerPanelsFromQueryParams } from "./trace-viewer/viewerPanels";

export default function App() {
	const [loadRequest, setLoadRequest] = createTraceLoadRequestSignal();
	const viewerPanels = readViewerPanelsFromQueryParams();
	const viewerAction = readViewerActionFromQueryParams();
	const viewerHighlight = readViewerHighlightFromQueryParams();
	const { traceInfoData, traceInfo } = useTraceInfoLoader(
		() => loadRequest()?.source ?? null,
	);
	const loadedTraceInfo = () => (loadRequest() ? traceInfo() : undefined);

	// The comparison loads once the trace has, so that the trace shows first and
	// loading it can't unload the comparison. Its failures are its own: the
	// trace shows as usual, with a notice where the comparison would be.
	const comparisonLabel = readComparisonLabelFromQueryParams();
	const comparisonSource = () => {
		const comparison = loadRequest()?.comparison;
		return comparison && traceInfoData.state === "ready" ? comparison : null;
	};
	const comparisonLoader = useTraceInfoLoader(comparisonSource, "comparison");
	const comparison = (): ViewerComparison | null => {
		if (!comparisonSource()) return null;
		if (comparisonLoader.traceInfoData.error) {
			return { status: "failed", label: comparisonLabel };
		}
		const info = comparisonLoader.traceInfo();
		return info
			? { status: "ready", label: comparisonLabel, traceInfo: info }
			: { status: "loading", label: comparisonLabel };
	};
	const urlLoadingSource = () => {
		const request = loadRequest();
		if (request?.origin !== "url" || !traceInfoData.loading) {
			return undefined;
		}
		return request.source;
	};
	const accessFailure = () => {
		const error = traceInfoData.error;
		return loadRequest() && error instanceof TraceAccessError
			? error.failure
			: undefined;
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
						{(info) => (
							<TraceViewer
								traceInfo={info()}
								panels={viewerPanels}
								action={viewerAction}
								highlight={viewerHighlight}
								comparison={comparison()}
							/>
						)}
					</Match>
					<Match when={urlLoadingSource()}>
						{(source) => (
							<TraceViewerSkeleton
								panels={viewerPanels}
								hasAction={viewerAction !== null}
								message={`Loading trace. ${loadingMessage(source())}`}
							/>
						)}
					</Match>
					<Match when={accessFailure()}>
						{(failure) => (
							<TraceAccessDenied
								failure={failure()}
								onLoadAnother={() => setLoadRequest(null)}
							/>
						)}
					</Match>
				</Switch>
			</div>
		</ErrorBoundary>
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
