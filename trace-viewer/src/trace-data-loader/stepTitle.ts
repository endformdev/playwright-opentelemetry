/**
 * Step titles say what a step did and subtitles what it acted on: title
 * `Click`, subtitle `getByRole('button')`. The reporter records both from
 * Playwright (1.63+) as `test.step.title` and `test.step.subtitle`.
 */
export interface StepTitle {
	title: string;
	subtitle?: string;
}

/**
 * Traces recorded before the reporter kept subtitles have the locator glued
 * onto the title, e.g. `Click getByRole('button')` or
 * `Expect "toBeVisible" getByText('Plan')`. Splits off that trailing locator,
 * stepping over quoted values so a filled-in `"getByRole("` stays put.
 * Returns null when the title has no trailing locator.
 */
export function splitLegacyStepTitle(title: string): StepTitle | null {
	const match = LEGACY_LOCATOR_SUFFIX.exec(title);
	return match ? { title: match[1], subtitle: match[2] } : null;
}

const LEGACY_LOCATOR_SUFFIX =
	/^((?:[^"]|"[^"]*")+?) ((?:getBy[A-Z][A-Za-z]*|locator|frameLocator)\(.*)$/s;

/** One-line form for places with room for a single line, like timeline bars. */
export function formatStepTitle({ title, subtitle }: StepTitle): string {
	return subtitle ? `${title} ${subtitle}` : title;
}
