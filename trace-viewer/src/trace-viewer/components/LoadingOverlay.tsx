import type { JSX } from "solid-js";

export function LoadingOverlay(): JSX.Element {
	return (
		<div class="absolute inset-0 bg-white/80 flex items-center justify-center z-50">
			<div class="text-center">
				<div class="text-gray-600 mb-2">Loading trace data...</div>
				<div class="mx-auto mt-3 h-6 w-6 rounded-full border-2 border-gray-300 border-t-blue-500 animate-spin" />
			</div>
		</div>
	);
}
