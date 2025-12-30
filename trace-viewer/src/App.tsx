import { ErrorBoundary, Show } from "solid-js";
import { NoTraceLoaded } from "./NoTraceLoaded";
import { TraceInfoLoader } from "./trace-info-loader";
import { createTraceSourceSignal } from "./trace-source";
import { TraceViewer } from "./trace-viewer";

export default function App() {
	const [traceSource, setTraceSource] = createTraceSourceSignal();

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
				<Show
					when={traceSource()}
					fallback={<NoTraceLoaded setTraceSource={setTraceSource} />}
				>
					{(source) => (
						<TraceInfoLoader source={source()}>
							{(traceInfo) => <TraceViewer traceInfo={traceInfo} />}
						</TraceInfoLoader>
					)}
				</Show>
			</div>
		</ErrorBoundary>
	);
}
