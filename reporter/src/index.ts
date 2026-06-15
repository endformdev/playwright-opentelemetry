import { PlaywrightOpentelemetryReporter } from "./reporter/reporter";

export type {
	PlaywrightOpentelemetryConfig,
	PlaywrightOpentelemetryUseOptions,
} from "./shared/config";
export type { PlaywrightTraceOption } from "./shared/playwright-trace";

export default PlaywrightOpentelemetryReporter;
