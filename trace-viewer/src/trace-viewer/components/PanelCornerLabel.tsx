import type { JSX } from "solid-js";

/**
 * Section name floating in the bottom-left corner of a timeline panel. A soft
 * gradient in the panel background color keeps it readable over spans without
 * taking up a row of its own. The parent must be positioned.
 */
export function PanelCornerLabel(props: { title: string }): JSX.Element {
	return (
		<div
			aria-hidden="true"
			class="absolute bottom-0 left-0 z-10 pointer-events-none select-none pl-3 pr-16 pt-8 pb-1.5 eyebrow text-gray-500"
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
