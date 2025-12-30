import { createSignal } from "solid-js";
import type { TraceSourceSetter } from "./trace-source";

export function NoTraceLoaded(props: { setTraceSource: TraceSourceSetter }) {
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
