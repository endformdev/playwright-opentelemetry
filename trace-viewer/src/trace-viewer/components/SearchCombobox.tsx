import {
	Combobox,
	type ComboboxHighlightChangeDetails,
	type ComboboxInputValueChangeDetails,
	type ComboboxOpenChangeDetails,
	type ComboboxValueChangeDetails,
	useListCollection,
} from "@ark-ui/solid/combobox";
import Search from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import {
	createEffect,
	createSignal,
	For,
	type JSX,
	onCleanup,
	Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import type { SearchMatch } from "../../search";

export interface SearchComboboxProps {
	results: SearchMatch[];
	query: string;
	onQueryChange: (value: string) => void;
	onClear: () => void;
	onResultSelect: (spanId: string) => void;
	onResultHover?: (spanId: string | null) => void;
	placeholder?: string;
}

const MAX_RESULTS = 50;

/**
 * Highlights the matched text in a string based on ranges from uFuzzy.
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
	const specialFields = new Set(["kind", "name", "title", "serviceName"]);
	return specialFields.has(key) ? value : `${key}: ${value}`;
}

export function SearchCombobox(props: SearchComboboxProps) {
	// Debounce logic - keep local value for responsive typing
	const [localValue, setLocalValue] = createSignal(props.query);
	const [isOpen, setIsOpen] = createSignal(false);
	let debounceTimeout: number | undefined;

	// Sync external query changes (e.g., when cleared externally)
	createEffect(() => setLocalValue(props.query));

	// Auto-open when there's text and results, but allow manual close
	createEffect(() => {
		if (localValue().length > 0 && props.results.length > 0) {
			setIsOpen(true);
		} else {
			setIsOpen(false);
		}
	});

	// Collection for combobox items
	const { collection, set } = useListCollection<SearchMatch>({
		initialItems: [],
		itemToString: (item) => formatKeyValue(item.key, item.value),
		itemToValue: (item) => `${item.spanId}-${item.key}`,
	});

	// Update collection when results change (limited to MAX_RESULTS)
	createEffect(() => set(props.results.slice(0, MAX_RESULTS)));

	const handleInputChange = (details: ComboboxInputValueChangeDetails) => {
		if (details.reason === "input-change") {
			setLocalValue(details.inputValue);

			if (debounceTimeout) clearTimeout(debounceTimeout);
			debounceTimeout = window.setTimeout(() => {
				props.onQueryChange(details.inputValue);
			}, 200);
		}
	};

	const handleOpenChange = (details: ComboboxOpenChangeDetails) => {
		// Allow closing (escape key, click outside, etc.)
		if (!details.open) {
			setIsOpen(false);
			// Clear hover when closing
			props.onResultHover?.(null);
		}
	};

	const handleValueChange = (
		details: ComboboxValueChangeDetails<SearchMatch>,
	) => {
		const selectedItem = details.items[0];
		if (selectedItem) {
			props.onResultSelect(selectedItem.spanId);
			// Close dropdown and clear hover on selection
			setIsOpen(false);
			props.onResultHover?.(null);
		}
	};

	const handleHighlightChange = (
		details: ComboboxHighlightChangeDetails<SearchMatch>,
	) => {
		props.onResultHover?.(details.highlightedItem?.spanId ?? null);
	};

	const handleClear = () => {
		setLocalValue("");
		setIsOpen(false);
		if (debounceTimeout) clearTimeout(debounceTimeout);
		props.onClear();
		props.onResultHover?.(null);
	};

	onCleanup(() => {
		if (debounceTimeout) clearTimeout(debounceTimeout);
	});

	return (
		<Combobox.Root
			collection={collection()}
			inputValue={localValue()}
			onInputValueChange={handleInputChange}
			onOpenChange={handleOpenChange}
			onValueChange={handleValueChange}
			onHighlightChange={handleHighlightChange}
			open={isOpen()}
			allowCustomValue={true}
			selectionBehavior="preserve"
			multiple={false}
		>
			<Combobox.Control class="relative flex items-center">
				<div class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
					<Search size={16} class="text-gray-400" />
				</div>

				<Combobox.Input
					class="w-full pl-9 pr-8 py-1.5 text-sm border border-gray-300 rounded-md 
                 bg-gray-50 focus:bg-white
                 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					placeholder={props.placeholder || "Search spans..."}
				/>

				<Show when={localValue()}>
					<Combobox.ClearTrigger
						onClick={handleClear}
						class="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-200 rounded"
						title="Clear search"
					>
						<X size={14} class="text-gray-500" />
					</Combobox.ClearTrigger>
				</Show>
			</Combobox.Control>

			<Portal>
				<Combobox.Positioner>
					<Combobox.Content class="mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-96 overflow-y-auto z-50">
						<Show
							when={collection().items.length > 0}
							fallback={
								<Show when={localValue()}>
									<div class="px-4 py-3 text-sm text-gray-500">
										No results found
									</div>
								</Show>
							}
						>
							<For each={collection().items}>
								{(item) => (
									<Combobox.Item
										item={item}
										class="w-full text-left px-4 py-2 border-b border-gray-100 last:border-b-0
                           data-[highlighted]:bg-blue-50 cursor-pointer"
									>
										<Combobox.ItemText class="text-sm font-mono">
											{highlightMatches(
												formatKeyValue(item.key, item.value),
												item.ranges,
											)}
										</Combobox.ItemText>
										<div class="text-xs text-gray-500 mt-0.5 truncate">
											{item.spanTitle}
										</div>
									</Combobox.Item>
								)}
							</For>

							<Show when={props.results.length > MAX_RESULTS}>
								<div class="px-4 py-2 text-xs text-gray-400 bg-gray-50 border-t border-gray-200">
									Showing {MAX_RESULTS} of {props.results.length} results
								</div>
							</Show>
						</Show>
					</Combobox.Content>
				</Combobox.Positioner>
			</Portal>
		</Combobox.Root>
	);
}
