import {
	type Accessor,
	createContext,
	createMemo,
	createSignal,
	type ParentComponent,
	useContext,
} from "solid-js";
import {
	buildHaystack,
	buildSearchIndex,
	type SearchMatch,
	searchSpans,
} from "../../search";
import type { Span } from "../../trace-data-loader/exportToSpans";

export interface SearchContextValue {
	query: Accessor<string>;
	setQuery: (query: string) => void;
	clearSearch: () => void;
	results: Accessor<SearchMatch[]>;
	matchedSpanIds: Accessor<Set<string>>;
	matchedAttributes: Accessor<Map<string, Set<string>>>;
}

const SearchContext = createContext<SearchContextValue>();

export interface SearchProviderProps {
	spans: Accessor<Span[]>;
}

export const SearchProvider: ParentComponent<SearchProviderProps> = (props) => {
	const [query, setQuery] = createSignal("");

	// Build and cache the search index
	const searchIndex = createMemo(() => buildSearchIndex(props.spans()));
	const haystack = createMemo(() => buildHaystack(searchIndex()));

	// Perform search when query changes
	const results = createMemo(() => {
		const q = query();
		if (!q) return [];
		return searchSpans(searchIndex(), haystack(), q, props.spans());
	});

	// Set of span IDs that match the search
	const matchedSpanIds = createMemo(() => {
		const matches = results();
		return new Set(matches.map((m) => m.spanId));
	});

	// Map of spanId -> Set of matched attribute keys for highlighting
	const matchedAttributes = createMemo(() => {
		const matches = results();
		const map = new Map<string, Set<string>>();

		for (const match of matches) {
			const existing = map.get(match.spanId);
			if (existing) {
				existing.add(match.key);
			} else {
				map.set(match.spanId, new Set([match.key]));
			}
		}

		return map;
	});

	const clearSearch = () => {
		setQuery("");
	};

	const value: SearchContextValue = {
		query,
		setQuery,
		clearSearch,
		results,
		matchedSpanIds,
		matchedAttributes,
	};

	return (
		<SearchContext.Provider value={value}>
			{props.children}
		</SearchContext.Provider>
	);
};

export function useSearch(): SearchContextValue {
	const context = useContext(SearchContext);
	if (!context) {
		throw new Error("useSearch must be used within a SearchProvider");
	}
	return context;
}
