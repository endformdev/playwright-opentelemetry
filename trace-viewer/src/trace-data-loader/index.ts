export type { CategorizedSpans } from "./categorizeSpans";
export { categorizeSpan, categorizeSpans, mergeSpans } from "./categorizeSpans";

export { fetchTraceData } from "./fetchTraceData";

export type { NormalizedSpan, SpanKind } from "./normalizeSpans";
export { normalizeOtlpExport, normalizeSpan } from "./normalizeSpans";

export type { LoadStatus, TraceDataLoaderResult } from "./useTraceDataLoader";
export { useTraceDataLoader } from "./useTraceDataLoader";
