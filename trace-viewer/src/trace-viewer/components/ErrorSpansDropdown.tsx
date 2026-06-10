import {
	Menu,
	type MenuHighlightChangeDetails,
	type MenuOpenChangeDetails,
} from "@ark-ui/solid/menu";
import { CircleAlert } from "lucide-solid";
import { For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { Span } from "../../trace-data-loader/exportToSpans";
import { formatDuration } from "../formatters";

export interface ErrorSpansDropdownProps {
	spans: Span[];
	onSpanSelect: (spanId: string) => void;
	onSpanHover?: (spanId: string | null) => void;
}

export function ErrorSpansDropdown(props: ErrorSpansDropdownProps) {
	const errorCount = () => props.spans.length;

	const handleOpenChange = (details: MenuOpenChangeDetails) => {
		if (!details.open) props.onSpanHover?.(null);
	};

	const handleHighlightChange = (details: MenuHighlightChangeDetails) => {
		props.onSpanHover?.(details.highlightedValue);
	};

	const handleItemSelect = (span: Span) => () => {
		props.onSpanSelect(span.id);
		props.onSpanHover?.(null);
	};

	return (
		<Menu.Root
			onOpenChange={handleOpenChange}
			onHighlightChange={handleHighlightChange}
			positioning={{ placement: "bottom-end", gutter: 4, overflowPadding: 8 }}
			loopFocus={true}
		>
			<Menu.Trigger
				type="button"
				class="inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-full border px-2.5 text-sm font-semibold leading-none transition-colors"
				classList={{
					"border-red-300 bg-red-50 text-red-700 hover:bg-red-100":
						errorCount() > 0,
					"border-gray-200 bg-gray-50 text-gray-300": errorCount() === 0,
				}}
				disabled={errorCount() === 0}
				aria-label={`${errorCount()} error spans`}
				data-testid="error-spans-button"
				title={errorCount() > 0 ? "Show error spans" : "No error spans"}
			>
				<CircleAlert size={15} strokeWidth={2.4} aria-hidden="true" />
				<Show when={errorCount() > 0}>
					<span
						class="text-xs leading-none tabular-nums"
						data-testid="error-spans-count"
					>
						{errorCount()}
					</span>
				</Show>
			</Menu.Trigger>

			<Portal>
				<Menu.Positioner>
					<Menu.Content
						class="mt-1 max-h-96 w-[min(24rem,calc(100vw-1rem))] overflow-y-auto rounded-md border border-red-200 bg-white shadow-lg z-50"
						data-testid="error-spans-dropdown"
					>
						<Menu.ItemGroup id="error-spans">
							<Menu.ItemGroupLabel class="border-b border-red-100 bg-red-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-red-700">
								Error Spans ({errorCount()})
							</Menu.ItemGroupLabel>
							<For each={props.spans}>
								{(span) => (
									<Menu.Item
										value={span.id}
										valueText={span.title}
										class="block w-full cursor-pointer border-b border-gray-100 px-4 py-3 text-left last:border-b-0 data-[highlighted]:bg-red-50"
										data-testid="error-spans-item"
										onSelect={handleItemSelect(span)}
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
												<div
													class="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap text-xs text-red-700"
													data-testid="error-spans-item-message"
												>
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
									</Menu.Item>
								)}
							</For>
						</Menu.ItemGroup>
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu.Root>
	);
}

function formatLocation(span: Span): string | null {
	const file = span.attributes["code.file.path"];
	const line = span.attributes["code.line.number"];
	if (typeof file !== "string") return null;
	return typeof line === "number" ? `${file}:${line}` : file;
}
