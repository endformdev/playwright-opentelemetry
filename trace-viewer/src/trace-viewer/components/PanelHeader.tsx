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

/**
 * Section name floating in the bottom-left corner of a timeline panel. A soft
 * gradient in the panel background color keeps it readable over spans without
 * taking up a row of its own. The parent must be positioned.
 */
export function PanelCornerLabel(props: { title: string }): JSX.Element {
	return (
		<div
			aria-hidden="true"
			class="absolute bottom-0 left-0 z-10 pointer-events-none select-none pl-3 pr-16 pt-8 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400"
		>
			<div
				class="absolute inset-0 bg-gray-50/90 backdrop-blur-[2px]"
				style={{
					"mask-image":
						"radial-gradient(ellipse farthest-side at 0% 100%, black 70%, transparent 100%)",
				}}
			/>
			<span class="relative">{props.title}</span>
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
