import { PlaywrightOpentelemetryReporter } from "./reporter/reporter";

export type { PlaywrightOpentelemetryReporterOptions } from "./reporter";
export type { TestInfo } from "./reporter/trace-zip-builder";

export default PlaywrightOpentelemetryReporter;
