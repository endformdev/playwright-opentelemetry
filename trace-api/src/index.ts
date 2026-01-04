export {
	OTLP_TRACES_WRITE_PATH,
	PLAYWRIGHT_OPENTELEMETRY_WRITE_PATH,
	TRACES_READ_PATH,
} from "./api";

export type { TraceApiConfig } from "./createTraceApi";
export { createTraceApi } from "./createTraceApi";

export { createOtlpHandler } from "./handlers/otlp";
export { createPlaywrightHandler } from "./handlers/playwright";
export { createViewerHandler } from "./handlers/viewer";

export type { StorageConfig, TraceStorage } from "./storage/s3";
export { createS3Storage } from "./storage/s3";
