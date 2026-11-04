import { For } from "solid-js";

/**
 * Playwright quotes the values it fills into a title (`Expect "toBeVisible"`,
 * `Fill "a@b.c"`); they are set off from the words around them.
 */
export function StepTitleText(props: { title: string; emphasisColor: string }) {
	const parts = () => props.title.split(/("[^"]*")/).filter(Boolean);
	return (
		<For each={parts()}>
			{(part) =>
				part.length > 1 && part.startsWith('"') && part.endsWith('"') ? (
					<span style={{ color: props.emphasisColor }}>{part}</span>
				) : (
					part
				)
			}
		</For>
	);
}
