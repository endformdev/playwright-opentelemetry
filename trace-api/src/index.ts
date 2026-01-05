export {
	OTLP_TRACES_WRITE_PATH,
	PLAYWRIGHT_REPORTER_WRITE_PATH,
	TRACE_VIEWER_READ_PATH,
} from "./api";

export type { TraceApiConfig, TraceApiHandlerConfig } from "./createTraceApi";
export { createTraceApi } from "./createTraceApi";

export { createOtlpHandler } from "./handlers/otlp";
export { createPlaywrightHandler } from "./handlers/playwright";
export { createViewerHandler } from "./handlers/viewer";

export type { StorageConfig, TraceStorage } from "./storage/s3";
export { createS3Storage } from "./storage/s3";
