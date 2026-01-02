import { type JSX, For, Show } from "solid-js";
import type { SearchMatch } from "../../search";

export interface SearchResultsProps {
	results: SearchMatch[];
	onResultClick: (spanId: string) => void;
	onResultHover?: (spanId: string | null) => void;
	maxResults?: number;
}

/**
 * Highlights the matched text in a string based on ranges.
 */
function highlightMatches(
	text: string,
	ranges: [number, number][],
): JSX.Element {
	if (ranges.length === 0) {
		return <span>{text}</span>;
	}

	const parts: JSX.Element[] = [];
	let lastIndex = 0;

	for (const [start, end] of ranges) {
		// Add non-highlighted text before this range
		if (start > lastIndex) {
			parts.push(<span>{text.slice(lastIndex, start)}</span>);
		}

		// Add highlighted text
		parts.push(
			<span class="bg-yellow-200 font-semibold">
				{text.slice(start, end + 1)}
			</span>,
		);

		lastIndex = end + 1;
	}

	// Add remaining text
	if (lastIndex < text.length) {
		parts.push(<span>{text.slice(lastIndex)}</span>);
	}

	return <>{parts}</>;
}

/**
 * Formats a key-value pair for display.
 * Special handling for built-in fields like kind, name, title, serviceName.
 */
function formatKeyValue(key: string, value: string): string {
	// For special fields, just show the value
	const specialFields = new Set(["kind", "name", "title", "serviceName"]);
	if (specialFields.has(key)) {
		return value;
	}

	// For regular attributes, show key: value
	return `${key}: ${value}`;
}

export function SearchResults(props: SearchResultsProps) {
	const maxResults = () => props.maxResults || 50;
	const displayedResults = () => props.results.slice(0, maxResults());
	const hasMore = () => props.results.length > maxResults();

	return (
		<div class="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-96 overflow-y-auto z-50">
			<Show
				when={props.results.length > 0}
				fallback={
					<div class="px-4 py-3 text-sm text-gray-500">No results found</div>
				}
			>
				<For each={displayedResults()}>
					{(result) => (
						<button
							type="button"
							onClick={() => props.onResultClick(result.spanId)}
							onMouseEnter={() => props.onResultHover?.(result.spanId)}
							onMouseLeave={() => props.onResultHover?.(null)}
							class="w-full text-left px-4 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-b-0 focus:outline-none focus:bg-blue-100"
						>
							<div class="text-sm font-mono">
								{highlightMatches(
									formatKeyValue(result.key, result.value),
									result.ranges,
								)}
							</div>
							<div class="text-xs text-gray-500 mt-0.5 truncate">
								{result.spanTitle}
							</div>
						</button>
					)}
				</For>

				<Show when={hasMore()}>
					<div class="px-4 py-2 text-xs text-gray-400 bg-gray-50 border-t border-gray-200">
						Showing {maxResults()} of {props.results.length} results
					</div>
				</Show>
			</Show>
		</div>
	);
}
