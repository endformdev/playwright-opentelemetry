import { ErrorBoundary, Show } from "solid-js";
import { type ResolvedTraceUrls, TraceLoader } from "./traceLoader";
import { createTraceSourceSignal } from "./traceSource";

export default function App() {
	const [traceSource, setTraceSource] = createTraceSourceSignal();

	return (
		<ErrorBoundary
			fallback={(error, reset) => (
				<div>
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
					fallback={
						<div class="flex-1 flex items-center justify-center">
							<p>No trace source. Please load a trace file or provide a URL.</p>
						</div>
					}
				>
					{(source) => (
						<TraceLoader source={source()}>
							{(urls) => <TraceViewer urls={urls} />}
						</TraceLoader>
					)}
				</Show>
			</div>
		</ErrorBoundary>
	);
}

/**
 * Placeholder TraceViewer component.
 * This will be implemented later to display the actual trace data.
 */
function TraceViewer(props: { urls: ResolvedTraceUrls }) {
	return (
		<div class="flex-1 p-4">
			<h1 class="text-xl font-bold mb-4">Trace Loaded</h1>
			<div class="mb-4">
				<h2 class="font-semibold">Trace Data URLs:</h2>
				<ul class="list-disc list-inside">
					{props.urls.traceDataUrls.map((url) => (
						<li class="text-sm font-mono">{url}</li>
					))}
				</ul>
			</div>
			<div>
				<h2 class="font-semibold">
					Screenshots ({props.urls.screenshotUrls.size}):
				</h2>
				<ul class="list-disc list-inside max-h-64 overflow-auto">
					{[...props.urls.screenshotUrls.entries()].map(([name, url]) => (
						<li class="text-sm">
							<span class="font-mono">{name}</span>
							<span class="text-gray-500"> → </span>
							<span class="font-mono text-xs">{url}</span>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}
