import { type Component, Show, onMount, createSignal, For } from "solid-js";
import {
	loadingState,
	loadTraceFromZip,
	initializeServiceWorker,
	rawData,
	testInfo,
	rootSpan,
	screenshots,
	networkSpans,
	timeRange,
} from "./stores/traceStore";

const App: Component = () => {
	const [dragOver, setDragOver] = createSignal(false);

	onMount(async () => {
		// Initialize service worker on mount
		await initializeServiceWorker();
	});

	const handleDrop = async (event: DragEvent) => {
		event.preventDefault();
		setDragOver(false);

		const files = event.dataTransfer?.files;
		if (!files?.length) return;

		const file = files[0];
		if (file.type === "application/zip" || file.name.endsWith(".zip")) {
			await loadTraceFromZip(file);
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

	const handleFileSelect = async (
		event: Event & { currentTarget: HTMLInputElement },
	) => {
		const files = event.currentTarget.files;
		if (!files?.length) return;

		const file = files[0];
		if (file.type === "application/zip" || file.name.endsWith(".zip")) {
			await loadTraceFromZip(file);
		}
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Drop zone needs drag events
		<div
			class="min-h-screen bg-gray-900 text-gray-100 flex flex-col"
			onDrop={handleDrop}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
		>
			{/* Header */}
			<header class="bg-gray-800 border-b border-gray-700 px-4 py-3">
				<div class="flex items-center gap-4">
					<h1 class="text-lg font-semibold text-white">
						Playwright OpenTelemetry Trace Viewer
					</h1>
					<Show when={loadingState().status === "loaded" && testInfo()}>
						<span class="text-gray-400">|</span>
						<span class="text-gray-300">{testInfo()?.title}</span>
						<span
							class={`px-2 py-0.5 rounded text-xs font-medium ${
								testInfo()?.outcome === "passed"
									? "bg-green-900 text-green-300"
									: testInfo()?.outcome === "failed"
										? "bg-red-900 text-red-300"
										: "bg-gray-700 text-gray-300"
							}`}
						>
							{testInfo()?.outcome}
						</span>
						<span class="text-gray-400 text-sm">{testInfo()?.duration}ms</span>
					</Show>
				</div>
			</header>

			{/* Main content */}
			<main class="flex-1 flex overflow-hidden">
				<Show
					when={loadingState().status === "loaded"}
					fallback={
						<DropZone
							dragOver={dragOver()}
							loadingState={loadingState()}
							onFileSelect={handleFileSelect}
						/>
					}
				>
					<TraceLayout />
				</Show>
			</main>
		</div>
	);
};

/**
 * Drop zone for loading trace files
 */
const DropZone: Component<{
	dragOver: boolean;
	loadingState: ReturnType<typeof loadingState>;
	onFileSelect: (event: Event & { currentTarget: HTMLInputElement }) => void;
}> = (props) => {
	return (
		<div
			class={`flex-1 flex items-center justify-center ${
				props.dragOver ? "bg-blue-900/20" : ""
			}`}
		>
			<div class="text-center space-y-4">
				<Show when={props.loadingState.status === "loading"}>
					<div class="space-y-2">
						<div class="text-lg">Loading trace...</div>
						<div class="w-64 h-2 bg-gray-700 rounded-full overflow-hidden">
							<div
								class="h-full bg-blue-500 transition-all duration-200"
								style={{
									width: `${(props.loadingState as { status: "loading"; progress: number }).progress}%`,
								}}
							/>
						</div>
					</div>
				</Show>

				<Show when={props.loadingState.status === "error"}>
					<div class="text-red-400">
						Error:{" "}
						{(props.loadingState as { status: "error"; error: string }).error}
					</div>
				</Show>

				<Show
					when={
						props.loadingState.status === "idle" ||
						props.loadingState.status === "error"
					}
				>
					<div class="space-y-4">
						<div class="text-2xl font-light text-gray-400">
							{props.dragOver
								? "Drop trace ZIP file here"
								: "Drop Playwright OpenTelemetry trace to load"}
						</div>
						<div class="text-gray-500">or</div>
						<label class="inline-block">
							<span class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded cursor-pointer transition-colors">
								Select file
							</span>
							<input
								type="file"
								accept=".zip,application/zip"
								class="hidden"
								onChange={props.onFileSelect}
							/>
						</label>
						<div class="text-sm text-gray-500 mt-8">
							Trace files are processed locally in your browser
						</div>
					</div>
				</Show>
			</div>
		</div>
	);
};

/**
 * Main trace layout with panels showing raw JSON data
 */
const TraceLayout: Component = () => {
	return (
		<div class="flex-1 flex">
			{/* Main panel - 70% */}
			<div class="flex-[7] flex flex-col border-r border-gray-700 overflow-hidden">
				{/* Screenshot filmstrip placeholder */}
				<div class="border-b border-gray-700 p-4 bg-gray-800">
					<h2 class="text-sm font-semibold text-gray-400 mb-2">
						Screenshots ({screenshots().length})
					</h2>
					<div class="flex gap-2 overflow-x-auto">
						<For each={screenshots()}>
							{(screenshot) => (
								<div class="flex-shrink-0 w-24 h-16 bg-gray-700 rounded text-xs text-gray-500 flex items-center justify-center">
									{screenshot.filename.slice(0, 12)}...
								</div>
							)}
						</For>
						<Show when={screenshots().length === 0}>
							<div class="text-gray-500 text-sm">No screenshots</div>
						</Show>
					</div>
				</div>

				{/* Steps timeline - raw JSON */}
				<div class="flex-1 overflow-auto p-4">
					<h2 class="text-sm font-semibold text-gray-400 mb-2">
						Span Tree (Raw JSON)
					</h2>
					<JsonDisplay
						data={spanToSerializable(rootSpan())}
						maxHeight="400px"
					/>
				</div>

				{/* Traces panel */}
				<div class="border-t border-gray-700 p-4 bg-gray-800">
					<h2 class="text-sm font-semibold text-gray-400 mb-2">
						Network Spans ({networkSpans().length})
					</h2>
					<JsonDisplay
						data={networkSpans().map(spanToSerializable)}
						maxHeight="200px"
					/>
				</div>
			</div>

			{/* Details panel - 30% */}
			<div class="flex-[3] flex flex-col overflow-hidden">
				<div class="p-4 border-b border-gray-700 bg-gray-800">
					<h2 class="text-sm font-semibold text-gray-400">Details</h2>
				</div>

				<div class="flex-1 overflow-auto p-4 space-y-4">
					{/* Test Info */}
					<div>
						<h3 class="text-xs font-semibold text-gray-500 mb-1">Test Info</h3>
						<JsonDisplay data={testInfo()} maxHeight="200px" />
					</div>

					{/* Time Range */}
					<div>
						<h3 class="text-xs font-semibold text-gray-500 mb-1">Time Range</h3>
						<JsonDisplay data={timeRange()} maxHeight="100px" />
					</div>

					{/* Raw OTLP Data */}
					<div>
						<h3 class="text-xs font-semibold text-gray-500 mb-1">
							Raw OTLP JSON
						</h3>
						<JsonDisplay data={rawData()?.otlpJson} maxHeight="300px" />
					</div>
				</div>
			</div>
		</div>
	);
};

/**
 * JSON display component for showing raw data
 */
const JsonDisplay: Component<{
	data: unknown;
	maxHeight?: string;
}> = (props) => {
	return (
		<pre
			class="bg-gray-950 p-3 rounded text-xs font-mono text-gray-300 overflow-auto"
			style={{ "max-height": props.maxHeight || "300px" }}
		>
			{JSON.stringify(props.data, null, 2)}
		</pre>
	);
};

/**
 * Convert span to serializable format (remove circular refs from children)
 */
function spanToSerializable(
	span: ReturnType<typeof rootSpan>,
): Record<string, unknown> | null {
	if (!span) return null;

	return {
		id: span.id,
		parentId: span.parentId,
		name: span.name,
		kind: span.kind,
		startTime: span.startTime,
		endTime: span.endTime,
		duration: span.duration,
		depth: span.depth,
		attributes: span.attributes,
		childCount: span.children.length,
		children: span.children.map((child) => spanToSerializable(child)),
	};
}

export default App;
