// High-level convenience API
export { createTraceApi } from "./createTraceApi";
export type { TraceApiConfig, TraceApiApp } from "./createTraceApi";

// Low-level building blocks - Storage
export { createS3Storage } from "./storage/s3";
export type { StorageConfig, TraceStorage } from "./storage/s3";

// Low-level building blocks - Handlers
export { createOtlpHandler } from "./handlers/otlp";
export { createPlaywrightHandler } from "./handlers/playwright";
export { createViewerHandler } from "./handlers/viewer";
