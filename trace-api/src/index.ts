export type { TraceApiApp, TraceApiConfig } from "./createTraceApi";
export { createTraceApi } from "./createTraceApi";

export { createOtlpHandler } from "./handlers/otlp";
export { createPlaywrightHandler } from "./handlers/playwright";
export { createViewerHandler } from "./handlers/viewer";

export type { StorageConfig, TraceStorage } from "./storage/s3";
export { createS3Storage } from "./storage/s3";
