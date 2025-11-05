import { expect, test } from "vitest";
import PlaywrightOpentelemetryReporter from "../src";

test("PlaywrightOpentelemetryReporter is defined", () => {
	expect(PlaywrightOpentelemetryReporter).toBeDefined();
});
