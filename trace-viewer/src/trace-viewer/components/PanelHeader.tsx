import type { JSX } from "solid-js";

export interface PanelHeaderProps {
	/** Title to display in the header */
	title: string;
	/** Whether this header represents a disabled/empty section */
	disabled?: boolean;
	/** Optional tooltip text to explain why the section is disabled */
	disabledTooltip?: string;
}

/**
 * Reusable panel header component used by all timeline sections.
 * Can render in a normal or disabled state.
 */
export function PanelHeader(props: PanelHeaderProps): JSX.Element {
	return (
		<div
			class={`flex-shrink-0 px-3 py-2 border-b border-gray-200 text-xs font-semibold uppercase tracking-wide ${
				props.disabled
					? "text-gray-400 bg-gray-100 cursor-not-allowed"
					: "text-gray-500"
			}`}
			title={props.disabled ? props.disabledTooltip : undefined}
		>
			{props.title}
		</div>
	);
}

export interface DisabledSectionFooterProps {
	/** Array of section titles that are disabled */
	sections: Array<{
		title: string;
		tooltip?: string;
	}>;
}

/**
 * Footer bar that displays headers for all disabled/empty sections.
 * These are stacked at the very bottom of the main content area.
 */
export function DisabledSectionFooter(
	props: DisabledSectionFooterProps,
): JSX.Element {
	return (
		<div class="flex-shrink-0 border-t border-gray-300 bg-gray-100">
			{props.sections.map((section) => (
				<PanelHeader
					title={section.title}
					disabled={true}
					disabledTooltip={section.tooltip}
				/>
			))}
		</div>
	);
}
