import {
	type Component,
	createResource,
	createSignal,
	For,
	onMount,
	Show,
} from "solid-js";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
	createLocalZipSource,
	type LoadedTrace,
	loadTrace,
	parseTraceSourceParam,
	type TraceSource,
} from "./services/dataLoader";
import { traceSource } from "./services/queryState";
import {
	generateTraceId,
	loadTraceInServiceWorker,
	registerServiceWorker,
} from "./serviceWorker/register";
import type { Span } from "./types/trace";

/**
 * Local source signal for file drops.
 * When set, this takes precedence over the URL query parameter.
 */
const [localSource, setLocalSource] = createSignal<TraceSource | null>(null);

/**
 * Compute the effective trace source from either local drop or URL param.
 */
function getEffectiveSource(): TraceSource | null {
	const local = localSource();
	if (local) return local;

	return parseTraceSourceParam(traceSource());
}

/**
 * Progress signal for loading feedback
 */
const [loadProgress, setLoadProgress] = createSignal<number>(0);

const App: Component = () => {
	const [dragOver, setDragOver] = createSignal(false);
	const [serviceWorkerReady, setServiceWorkerReady] = createSignal(false);

	// Resource that loads trace data reactively based on source
	const [traceData, { refetch }] = createResource(
		getEffectiveSource,
		async (source) => {
			if (!source) return null;

			setLoadProgress(0);
			const result = await loadTrace(source, (done, total) => {
				setLoadProgress(Math.round((done / total) * 100));
			});

			// If we have screenshot blobs and service worker is ready,
			// load them into the service worker
			if (
				serviceWorkerReady() &&
				result.screenshotBlobs.size > 0 &&
				source.kind === "local-zip"
			) {
				const traceId = generateTraceId();
				await loadTraceInServiceWorker(
					traceId,
					result.screenshotBlobs,
					result.rawOtlpJson,
				);

				// Update screenshot URLs to use service worker paths
				for (const screenshot of result.parsedTrace.screenshots) {
					screenshot.url = `/screenshots/${traceId}/${screenshot.filename}`;
				}
			}

			return result;
		},
	);

	onMount(async () => {
		try {
			await registerServiceWorker();
			setServiceWorkerReady(true);
		} catch (error) {
			console.error("Failed to register service worker:", error);
			// Continue without service worker - screenshots will use blob URLs
		}
	});

	const handleDrop = async (event: DragEvent) => {
		event.preventDefault();
		setDragOver(false);

		const files = event.dataTransfer?.files;
		if (!files?.length) return;

		const file = files[0];
		if (file.type === "application/zip" || file.name.endsWith(".zip")) {
			setLocalSource(createLocalZipSource(file));
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
			setLocalSource(createLocalZipSource(file));
		}
	};

	// Derive states for cleaner conditionals
	const hasNoSource = () => !getEffectiveSource();
	const isLoading = () => traceData.loading;
	const hasError = () => traceData.error;
	const isLoaded = () => !traceData.loading && !traceData.error && traceData();

	return (
		<ErrorBoundary>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: Drop zone needs drag events */}
			<div
				class="min-h-screen bg-gray-900 text-gray-100 flex flex-col"
				onDrop={handleDrop}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
			>
				{/* Header */}
				<Header traceData={traceData()} />

				{/* Main content */}
				<main class="flex-1 flex overflow-hidden">
					<Show when={hasNoSource()}>
						<DropZoneHint
							dragOver={dragOver()}
							onFileSelect={handleFileSelect}
						/>
					</Show>

					<Show when={isLoading()}>
						<LoadingIndicator progress={loadProgress()} />
					</Show>

					<Show when={hasError()}>
						<ErrorDisplay
							error={traceData.error as Error}
							onRetry={() => refetch()}
						/>
					</Show>

					<Show when={isLoaded()}>
						{/* biome-ignore lint/style/noNonNullAssertion: isLoaded() guarantees traceData is defined */}
						<TraceLayout traceData={traceData()!} />
					</Show>
				</main>
			</div>
		</ErrorBoundary>
	);
};

/**
 * Header component showing test info when loaded
 */
const Header: Component<{ traceData: LoadedTrace | null | undefined }> = (
	props,
) => {
	const testInfo = () => props.traceData?.parsedTrace.testInfo;

	return (
		<header class="bg-gray-800 border-b border-gray-700 px-4 py-3">
			<div class="flex items-center gap-4">
				<h1 class="text-lg font-semibold text-white">
					Playwright OpenTelemetry Trace Viewer
				</h1>
				<Show when={testInfo()}>
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
	);
};

/**
 * Drop zone hint shown when no trace source is specified
 */
const DropZoneHint: Component<{
	dragOver: boolean;
	onFileSelect: (event: Event & { currentTarget: HTMLInputElement }) => void;
}> = (props) => {
	return (
		<div
			class={`flex-1 flex items-center justify-center ${
				props.dragOver ? "bg-blue-900/20" : ""
			}`}
		>
			<div class="text-center space-y-4">
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
		</div>
	);
};

/**
 * Loading indicator with progress bar
 */
const LoadingIndicator: Component<{ progress: number }> = (props) => {
	return (
		<div class="flex-1 flex items-center justify-center">
			<div class="text-center space-y-2">
				<div class="text-lg">Loading trace...</div>
				<div class="w-64 h-2 bg-gray-700 rounded-full overflow-hidden">
					<div
						class="h-full bg-blue-500 transition-all duration-200"
						style={{ width: `${props.progress}%` }}
					/>
				</div>
			</div>
		</div>
	);
};

/**
 * Error display with retry option
 */
const ErrorDisplay: Component<{ error: Error; onRetry: () => void }> = (
	props,
) => {
	return (
		<div class="flex-1 flex items-center justify-center">
			<div class="text-center space-y-4">
				<div class="text-red-400">Error loading trace:</div>
				<div class="text-gray-300 bg-gray-800 p-4 rounded max-w-lg">
					{props.error.message}
				</div>
				<button
					type="button"
					onClick={props.onRetry}
					class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded transition-colors"
				>
					Try again
				</button>
			</div>
		</div>
	);
};

/**
 * Main trace layout with panels showing raw JSON data
 */
const TraceLayout: Component<{ traceData: LoadedTrace }> = (props) => {
	const trace = () => props.traceData.parsedTrace;
	const rawOtlp = () => props.traceData.rawOtlpJson;

	const networkSpans = () =>
		[...trace().spans.values()]
			.filter((s) => s.kind === "network")
			.sort((a, b) => a.startTime - b.startTime);

	return (
		<div class="flex-1 flex">
			{/* Main panel - 70% */}
			<div class="flex-[7] flex flex-col border-r border-gray-700 overflow-hidden">
				{/* Screenshot filmstrip placeholder */}
				<div class="border-b border-gray-700 p-4 bg-gray-800">
					<h2 class="text-sm font-semibold text-gray-400 mb-2">
						Screenshots ({trace().screenshots.length})
					</h2>
					<div class="flex gap-2 overflow-x-auto">
						<For each={trace().screenshots}>
							{(screenshot) => (
								<div class="flex-shrink-0 w-24 h-16 bg-gray-700 rounded text-xs text-gray-500 flex items-center justify-center">
									{screenshot.filename.slice(0, 12)}...
								</div>
							)}
						</For>
						<Show when={trace().screenshots.length === 0}>
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
						data={spanToSerializable(trace().rootSpan)}
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
						<JsonDisplay data={trace().testInfo} maxHeight="200px" />
					</div>

					{/* Time Range */}
					<div>
						<h3 class="text-xs font-semibold text-gray-500 mb-1">Time Range</h3>
						<JsonDisplay data={trace().timeRange} maxHeight="100px" />
					</div>

					{/* Raw OTLP Data */}
					<div>
						<h3 class="text-xs font-semibold text-gray-500 mb-1">
							Raw OTLP JSON
						</h3>
						<JsonDisplay data={rawOtlp()} maxHeight="300px" />
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
function spanToSerializable(span: Span | null): Record<string, unknown> | null {
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
