import Search from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";

export interface SearchInputProps {
	value: string;
	onValueChange: (value: string) => void;
	onClear: () => void;
	placeholder?: string;
}

export function SearchInput(props: SearchInputProps) {
	let inputRef: HTMLInputElement | undefined;
	const [isFocused, setIsFocused] = createSignal(false);

	// Debounce the input
	const [localValue, setLocalValue] = createSignal(props.value);
	let debounceTimeout: number | undefined;

	createEffect(() => {
		// Update local value when prop changes externally
		setLocalValue(props.value);
	});

	const handleInput = (e: InputEvent) => {
		const target = e.target as HTMLInputElement;
		const newValue = target.value;
		setLocalValue(newValue);

		// Clear existing timeout
		if (debounceTimeout) {
			clearTimeout(debounceTimeout);
		}

		// Set new timeout
		debounceTimeout = window.setTimeout(() => {
			props.onValueChange(newValue);
		}, 200);
	};

	const handleClear = () => {
		setLocalValue("");
		props.onClear();
		inputRef?.focus();
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			handleClear();
		}
	};

	onCleanup(() => {
		if (debounceTimeout) {
			clearTimeout(debounceTimeout);
		}
	});

	return (
		<div class="relative flex items-center">
			<div class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
				<Search size={16} class="text-gray-400" />
			</div>

			<input
				ref={inputRef}
				type="text"
				value={localValue()}
				onInput={handleInput}
				onKeyDown={handleKeyDown}
				onFocus={() => setIsFocused(true)}
				onBlur={() => setIsFocused(false)}
				placeholder={props.placeholder || "Search spans..."}
				class={`
					w-full pl-9 pr-8 py-1.5 text-sm
					border border-gray-300 rounded-md
					focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
					${isFocused() ? "bg-white" : "bg-gray-50"}
				`}
			/>

			<Show when={localValue()}>
				<button
					type="button"
					onClick={handleClear}
					class="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-200 rounded"
					title="Clear search"
				>
					<X size={14} class="text-gray-500" />
				</button>
			</Show>
		</div>
	);
}
