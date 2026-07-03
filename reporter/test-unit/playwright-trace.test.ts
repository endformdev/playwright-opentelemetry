import { describe, expect, it } from "vitest";
import {
	couldRetainPlaywrightTrace,
	type PlaywrightTraceOption,
} from "../src/shared/playwright-trace";

describe("Playwright trace retention helpers", () => {
	it.each([
		["off", 0, false],
		["on", 0, true],
		["retain-on-failure", 0, true],
		["on-first-retry", 0, false],
		["on-first-retry", 1, true],
		["on-first-retry", 2, false],
		["retry-with-trace", 1, true],
		["on-all-retries", 0, false],
		["on-all-retries", 1, true],
		["retain-on-first-failure", 0, true],
		["retain-on-first-failure", 1, false],
		["retain-on-failure-and-retries", 0, true],
		["retain-on-failure-and-retries", 1, true],
	] satisfies Array<
		[PlaywrightTraceOption, number, boolean]
	>)("returns whether %s could retain before test completion on retry %s", (trace, retry, expected) => {
		expect(couldRetainPlaywrightTrace(trace, { retry })).toBe(expected);
	});

	it("treats an expected-failing test as possibly failing unexpectedly", () => {
		expect(
			couldRetainPlaywrightTrace("retain-on-failure", {
				expectedStatus: "failed",
				retry: 0,
			}),
		).toBe(true);
	});
});
