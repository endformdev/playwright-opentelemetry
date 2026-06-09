import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { isErrorSpan, type Span } from "../../trace-data-loader/exportToSpans";
import { formatDuration } from "../formatters";

export interface ErrorSpansDropdownProps {
	spans: Span[];
	onSpanSelect: (spanId: string) => void;
	onSpanHover?: (spanId: string | null) => void;
}

export function ErrorSpansDropdown(props: ErrorSpansDropdownProps) {
	const [isOpen, setIsOpen] = createSignal(false);
	let rootRef: HTMLDivElement | undefined;

	const errorSpans = () => props.spans.filter(isErrorSpan);
	const errorCount = () => errorSpans().length;

	const handleSelect = (spanId: string) => {
		props.onSpanSelect(spanId);
		props.onSpanHover?.(null);
		setIsOpen(false);
	};

	onMount(() => {
		const handlePointerDown = (event: PointerEvent) => {
			if (!rootRef?.contains(event.target as Node)) {
				props.onSpanHover?.(null);
				setIsOpen(false);
			}
		};

		document.addEventListener("pointerdown", handlePointerDown);
		onCleanup(() =>
			document.removeEventListener("pointerdown", handlePointerDown),
		);
	});

	return (
		<div ref={rootRef} class="relative">
			<button
				type="button"
				class="relative inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm font-semibold transition-colors"
				classList={{
					"border-red-300 bg-red-50 text-red-700 hover:bg-red-100":
						errorCount() > 0,
					"border-gray-200 bg-gray-50 text-gray-300": errorCount() === 0,
				}}
				disabled={errorCount() === 0}
				aria-label={`${errorCount()} error spans`}
				aria-expanded={isOpen()}
				data-testid="error-spans-button"
				title={errorCount() > 0 ? "Show error spans" : "No error spans"}
				onClick={() => setIsOpen(!isOpen())}
			>
				<span class="leading-none">!</span>
				<Show when={errorCount() > 0}>
					<span class="ml-1 text-xs" data-testid="error-spans-count">
						{errorCount()}
					</span>
				</Show>
			</button>

			<Show when={isOpen()}>
				<div
					class="absolute right-0 top-full z-50 mt-1 w-96 max-h-96 overflow-y-auto rounded-md border border-red-200 bg-white shadow-lg"
					data-testid="error-spans-dropdown"
				>
					<div class="border-b border-red-100 bg-red-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-red-700">
						Error Spans ({errorCount()})
					</div>
					<For each={errorSpans()}>
						{(span) => (
							<button
								type="button"
								class="block w-full border-b border-gray-100 px-4 py-3 text-left last:border-b-0 hover:bg-red-50"
								data-testid="error-spans-item"
								onMouseEnter={() => props.onSpanHover?.(span.id)}
								onMouseLeave={() => props.onSpanHover?.(null)}
								onClick={() => handleSelect(span.id)}
							>
								<div class="flex items-baseline gap-2">
									<span class="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-gray-900">
										{span.title}
									</span>
									<span class="shrink-0 font-mono text-xs text-gray-500">
										{formatDuration(span.startOffsetMs)}
									</span>
								</div>
								<Show when={span.status?.message}>
									{(message) => (
										<div class="mt-1 max-h-10 overflow-hidden text-xs text-red-700">
											{message()}
										</div>
									)}
								</Show>
								<div class="mt-1 flex items-center gap-2 text-xs text-gray-500">
									<span>{span.serviceName}</span>
									<Show when={formatLocation(span)}>
										{(location) => (
											<>
												<span class="text-gray-300">|</span>
												<span class="truncate font-mono">{location()}</span>
											</>
										)}
									</Show>
								</div>
							</button>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

function formatLocation(span: Span): string | null {
	const file = span.attributes["code.file.path"];
	const line = span.attributes["code.line.number"];
	if (typeof file !== "string") return null;
	return typeof line === "number" ? `${file}:${line}` : file;
}
