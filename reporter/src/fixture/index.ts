import { test as base } from "@playwright/test";
import { createPlaywrightOtelTest } from "./fixture";

export * from "@playwright/test";
export { createPlaywrightOtelTest } from "./fixture";
export type {
	PlaywrightOpentelemetryConfig,
	PlaywrightOpentelemetryUseOptions,
} from "../shared/config";
export const test = createPlaywrightOtelTest(base);
