import type { JSX } from "solid-js";

export interface LoadingOverlayProps {
	loaded: number;
	total: number;
}

export function LoadingOverlay(props: LoadingOverlayProps): JSX.Element {
	return (
		<div class="absolute inset-0 bg-white/80 flex items-center justify-center z-50">
			<div class="text-center">
				<div class="text-gray-600 mb-2">Loading trace data...</div>
				<div class="text-sm text-gray-400">
					{props.loaded} / {props.total} files
				</div>
				<div class="w-48 h-2 bg-gray-200 rounded-full mt-2 overflow-hidden">
					<div
						class="h-full bg-blue-500 transition-all duration-200"
						style={{
							width: `${props.total > 0 ? (props.loaded / props.total) * 100 : 0}%`,
						}}
					/>
				</div>
			</div>
		</div>
	);
}
