import {
	type Component,
	type JSX,
	ErrorBoundary as SolidErrorBoundary,
} from "solid-js";

export interface ErrorFallbackProps {
	error: Error;
	reset: () => void;
}

const DefaultErrorFallback: Component<ErrorFallbackProps> = (props) => {
	return (
		<div class="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center p-8">
			<div class="max-w-lg w-full bg-gray-800 rounded-lg border border-red-900 p-6 space-y-4">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-full bg-red-900/50 flex items-center justify-center">
						<svg
							class="w-6 h-6 text-red-400"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							aria-hidden="true"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
							/>
						</svg>
					</div>
					<h2 class="text-xl font-semibold text-red-400">
						Something went wrong
					</h2>
				</div>

				<div class="bg-gray-950 rounded p-4">
					<p class="text-sm text-gray-300 font-mono break-all">
						{props.error.message}
					</p>
				</div>

				{props.error.stack && (
					<details class="text-xs">
						<summary class="text-gray-500 cursor-pointer hover:text-gray-400">
							Stack trace
						</summary>
						<pre class="mt-2 bg-gray-950 rounded p-3 text-gray-400 overflow-auto max-h-48 font-mono">
							{props.error.stack}
						</pre>
					</details>
				)}

				<div class="flex gap-3 pt-2">
					<button
						type="button"
						onClick={props.reset}
						class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium transition-colors"
					>
						Try again
					</button>
					<button
						type="button"
						onClick={() => window.location.reload()}
						class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium transition-colors"
					>
						Reload page
					</button>
				</div>
			</div>
		</div>
	);
};

export interface ErrorBoundaryProps {
	fallback?: Component<ErrorFallbackProps>;
	children: JSX.Element;
}

export const ErrorBoundary: Component<ErrorBoundaryProps> = (props) => {
	const FallbackComponent = props.fallback ?? DefaultErrorFallback;

	return (
		<SolidErrorBoundary
			fallback={(error, reset) => (
				<FallbackComponent error={error} reset={reset} />
			)}
		>
			{props.children}
		</SolidErrorBoundary>
	);
};
