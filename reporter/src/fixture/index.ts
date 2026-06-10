import { test as base } from "@playwright/test";
import { createPlaywrightOtelTest } from "./playwright-opentelemetry-fixture";

export * from "@playwright/test";
export { createPlaywrightOtelTest } from "./playwright-opentelemetry-fixture";
export type {
	PlaywrightOpentelemetryConfig,
	PlaywrightOpentelemetryUseOptions,
} from "../shared/config";
export const test = createPlaywrightOtelTest(base);
