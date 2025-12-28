import { createSignal, ErrorBoundary, Show } from "solid-js";
import { type TraceInfo, TraceInfoLoader } from "./traceInfoLoader";
import { createTraceSourceSignal, type TraceSourceSetter } from "./traceSource";

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
					fallback={<DropZone setTraceSource={setTraceSource} />}
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

function DropZone(props: { setTraceSource: TraceSourceSetter }) {
	const [dragOver, setDragOver] = createSignal(false);

	const handleDrop = (event: DragEvent) => {
		event.preventDefault();
		setDragOver(false);

		const files = event.dataTransfer?.files;
		if (!files?.length) return;

		const file = files[0];
		if (file.type === "application/zip" || file.name.endsWith(".zip")) {
			props.setTraceSource({ kind: "local-zip", file });
		}
	};

	const handleDragOver = (event: DragEvent) => {
		event.preventDefault();
		if (event.dataTransfer?.types.includes("Files")) {
			setDragOver(true);
		}
	};

	const handleDragLeave = () => {
		setDragOver(false);
	};

	const handleFileSelect = (
		event: Event & { currentTarget: HTMLInputElement },
	) => {
		const files = event.currentTarget.files;
		if (!files?.length) return;

		const file = files[0];
		if (file.type === "application/zip" || file.name.endsWith(".zip")) {
			props.setTraceSource({ kind: "local-zip", file });
		}
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Drop zone needs drag events
		<div
			class={`flex-1 flex items-center justify-center ${dragOver() ? "bg-blue-900/20" : ""}`}
			onDrop={handleDrop}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
		>
			<div class="text-center space-y-4">
				<div class="text-2xl font-light text-gray-400">
					{dragOver()
						? "Drop trace ZIP file here"
						: "Drop Playwright OpenTelemetry trace to load"}
				</div>
				<div class="text-gray-500">or</div>
				<label class="inline-block">
					<span class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded cursor-pointer transition-colors text-white">
						Select file
					</span>
					<input
						type="file"
						accept=".zip,application/zip"
						class="hidden"
						onChange={handleFileSelect}
					/>
				</label>
			</div>
		</div>
	);
}

/**
 * Placeholder TraceViewer component.
 * This will be implemented later to display the actual trace data.
 */
function TraceViewer(props: { traceInfo: TraceInfo }) {
	const { testInfo, traceDataUrls, screenshots } = props.traceInfo;

	return (
		<div class="flex-1 p-4 overflow-auto">
			<h1 class="text-xl font-bold mb-4">Trace Loaded</h1>

			{/* Test Info Section */}
			<div class="mb-4">
				<h2 class="font-semibold mb-2">Test Info:</h2>
				<div class="text-sm space-y-1">
					<div>
						<span class="text-gray-400">Name: </span>
						<span class="font-mono">{testInfo.name}</span>
					</div>
					<div>
						<span class="text-gray-400">File: </span>
						<span class="font-mono">
							{testInfo.file}:{testInfo.line}
						</span>
					</div>
					<div>
						<span class="text-gray-400">Status: </span>
						<span
							class={
								testInfo.status === "passed"
									? "text-green-400"
									: testInfo.status === "failed"
										? "text-red-400"
										: "text-yellow-400"
							}
						>
							{testInfo.status}
						</span>
					</div>
					<div>
						<span class="text-gray-400">Trace ID: </span>
						<span class="font-mono text-xs">{testInfo.traceId}</span>
					</div>
					{testInfo.describes.length > 0 && (
						<div>
							<span class="text-gray-400">Describes: </span>
							<span class="font-mono">{testInfo.describes.join(" > ")}</span>
						</div>
					)}
				</div>
			</div>

			{/* Trace Data URLs Section */}
			<div class="mb-4">
				<h2 class="font-semibold">Trace Data URLs:</h2>
				<ul class="list-disc list-inside">
					{traceDataUrls.map((url) => (
						<li class="text-sm font-mono">{url}</li>
					))}
				</ul>
			</div>

			{/* Screenshots Section */}
			<div>
				<h2 class="font-semibold">Screenshots ({screenshots.length}):</h2>
				<ul class="list-disc list-inside max-h-64 overflow-auto">
					{screenshots.map((screenshot) => (
						<li class="text-sm">
							<span class="text-gray-400">
								{new Date(screenshot.timestamp).toISOString()}
							</span>
							<span class="text-gray-500"> → </span>
							<span class="font-mono text-xs">{screenshot.url}</span>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}
