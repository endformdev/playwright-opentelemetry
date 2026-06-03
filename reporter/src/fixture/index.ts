import { test as base } from "@playwright/test";
import { createPlaywrightOtelTest } from "./factory";

export * from "@playwright/test";
export { createPlaywrightOtelTest } from "./factory";
export const test = createPlaywrightOtelTest(base);
