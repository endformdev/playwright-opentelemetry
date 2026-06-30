import { test as base } from "@playwright/test";
import { createPlaywrightOtelTest } from "./playwright-opentelemetry-fixture";

export * from "@playwright/test";
export type {
	PlaywrightOpentelemetryConfig,
	PlaywrightOpentelemetryDestination,
	PlaywrightOpentelemetryUseOptions,
} from "../shared/config";
export type { PlaywrightTraceOption } from "../shared/playwright-trace";
export const test = createPlaywrightOtelTest(base);
