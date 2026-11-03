import { describe, expect, it } from "vitest";
import { formatStepTitle, splitLegacyStepTitle } from "./stepTitle";

describe("splitLegacyStepTitle", () => {
	it.each([
		[
			"Click getByRole('button', { name: 'Upgrade to Pro' })",
			"Click",
			"getByRole('button', { name: 'Upgrade to Pro' })",
		],
		[
			`Expect "toBeVisible" getByText('No active subscription')`,
			`Expect "toBeVisible"`,
			"getByText('No active subscription')",
		],
		[`Fill "a@b.c" getByLabel('Email')`, `Fill "a@b.c"`, "getByLabel('Email')"],
		[
			"Hover locator('[data-hydrated]').first()",
			"Hover",
			"locator('[data-hydrated]').first()",
		],
		[
			"Click frameLocator('iframe').getByRole('link')",
			"Click",
			"frameLocator('iframe').getByRole('link')",
		],
		[
			`Fill "type getByRole('x') here" getByLabel('Note')`,
			`Fill "type getByRole('x') here"`,
			"getByLabel('Note')",
		],
	])("splits %s", (legacy, title, subtitle) => {
		expect(splitLegacyStepTitle(legacy)).toEqual({ title, subtitle });
	});

	it.each([
		'Navigate to "/dashboard"',
		`Expect "toHaveURL"`,
		"Wait for timeout",
		"getByRole('button')",
	])("leaves %s alone", (title) => {
		expect(splitLegacyStepTitle(title)).toBeNull();
	});
});

describe("formatStepTitle", () => {
	it("joins the title and subtitle on one line", () => {
		expect(
			formatStepTitle({ title: "Click", subtitle: "getByRole('x')" }),
		).toBe("Click getByRole('x')");
		expect(formatStepTitle({ title: "Wait for timeout" })).toBe(
			"Wait for timeout",
		);
	});
});
